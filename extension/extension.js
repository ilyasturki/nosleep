// Quick Settings toggles + top-bar indicators for the nosleep inhibitors.
// Two independent stay-awake controls, each backed by its own transient
// systemd user unit, and each with its own distinct top-bar icon so the
// panel tells them apart at a glance (coffee cup vs. display, both when both):
//   • "Stay Awake"     — blocks suspend and lid-switch sleep (logind lock)
//   • "Keep Screen On" — blocks GNOME idle, so the screen never blanks/locks
//
// Deliberately stateless: each systemd user unit is the single source of
// truth. Clicking only starts/stops the transient unit over D-Bus; a
// toggle's `checked` and its top-bar icon follow the real unit state, so the
// UI can never desync from (or lose) an inhibitor. The bundled nosleep CLI
// drives the sleep unit, so either side can stop what the other started.
//
// Runs in the unlock-dialog session mode too (see metadata.json), so the
// toggles and indicator stay on the lock screen — letting you confirm or
// flip stay-awake without unlocking. Safe to expose there: the UI only
// starts/stops inhibitors and reveals nothing.
//
// Why two mechanisms? A logind sleep lock does not keep the GNOME screen
// on: screen blanking is driven by gnome-shell's idle timer, which only
// honors GNOME session inhibitors. So "Keep Screen On" holds its lock via
// gnome-session-inhibit rather than systemd-inhibit.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {QuickToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

const BUS_NAME = 'org.freedesktop.systemd1';
const MANAGER_PATH = '/org/freedesktop/systemd1';
const MANAGER_IFACE = 'org.freedesktop.systemd1.Manager';

// Mirror systemd's object-path escaping so a unit's path can be watched even
// while its transient unit does not exist: every byte outside [A-Za-z0-9]
// (and a leading digit) becomes _<hex>. e.g. nosleep.service ->
// .../unit/nosleep_2eservice; nosleep-screen.service -> nosleep_2dscreen_2eservice.
function unitObjectPath(unit) {
    let escaped = '';
    for (let i = 0; i < unit.length; i++) {
        const ch = unit[i];
        if (/[A-Za-z0-9]/.test(ch) && !(i === 0 && ch >= '0' && ch <= '9'))
            escaped += ch;
        else
            escaped += `_${unit.charCodeAt(i).toString(16).padStart(2, '0')}`;
    }
    return `${MANAGER_PATH}/unit/${escaped}`;
}

// Drives one transient-unit-backed toggle: owns its QuickToggle, watches its
// unit's ActiveState over D-Bus, and mirrors it onto `checked`. The unit is
// the source of truth — a click only starts/stops it; state comes back via
// signals. buildArgv() returns the inhibitor command (absolute paths, as
// ExecStart requires) or null when a required program is missing.
class InhibitorToggle {
    constructor(bus, cancellable, {title, gicon, indicator, unit, description, buildArgv}) {
        this._bus = bus;
        this._cancellable = cancellable;
        this._unit = unit;
        this._unitPath = unitObjectPath(unit);
        this._description = description;
        this._buildArgv = buildArgv;
        this.active = false;
        this._startRetryId = 0;

        // This inhibitor's own top-bar icon, shown only while it is active, so
        // the panel reads the same as the toggles: coffee cup for Stay Awake,
        // display for Keep Screen On, both side-by-side when both are on.
        this._indicator = indicator;
        this._indicator.gicon = gicon;
        this._indicator.visible = false;

        // toggleMode off: a click must not flip `checked` optimistically,
        // only the unit-state refresh may
        this.toggle = new QuickToggle({title, gicon, toggleMode: false});
        this.toggle.connectObject('clicked', () => this._toggleUnit(), this);

        this._signalIds = [
            this._bus.signal_subscribe(
                BUS_NAME, 'org.freedesktop.DBus.Properties', 'PropertiesChanged',
                this._unitPath, null, Gio.DBusSignalFlags.NONE,
                () => this._refresh()),
            ...['UnitNew', 'UnitRemoved'].map(signal =>
                this._bus.signal_subscribe(
                    BUS_NAME, MANAGER_IFACE, signal,
                    MANAGER_PATH, null, Gio.DBusSignalFlags.NONE,
                    (conn, sender, path, iface, name, params) => {
                        if (params.deepUnpack()[0] === this._unit)
                            this._refresh();
                    })),
        ];

        this._refresh();
    }

    // onError(e) may claim a non-cancelled failure by returning true (e.g. to
    // retry a UnitExists race); otherwise the failure is logged.
    _managerCall(method, params, onError) {
        this._bus.call(
            BUS_NAME, MANAGER_PATH, MANAGER_IFACE, method, params, null,
            Gio.DBusCallFlags.NONE, -1, this._cancellable,
            (bus, res) => {
                try {
                    bus.call_finish(res);
                    this._refresh();
                } catch (e) {
                    if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        return;
                    if (onError?.(e))
                        return;
                    console.warn(`nosleep: ${method} failed: ${e.message}`);
                }
            });
    }

    _refresh() {
        // GetUnit, unlike ListUnitsByNames, does not load a not-loaded unit.
        // A loading probe would emit the very UnitNew/UnitRemoved signals we
        // subscribe to, so every refresh would schedule the next one forever.
        this._bus.call(
            BUS_NAME, MANAGER_PATH, MANAGER_IFACE, 'GetUnit',
            new GLib.Variant('(s)', [this._unit]), null,
            Gio.DBusCallFlags.NONE, -1, this._cancellable,
            (bus, res) => {
                let path;
                try {
                    [path] = bus.call_finish(res).deepUnpack();
                } catch (e) {
                    if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        return;
                    if (Gio.DBusError.get_remote_error(e) !== 'org.freedesktop.systemd1.NoSuchUnit')
                        console.warn(`nosleep: GetUnit failed: ${e.message}`);
                    this._setActive(false);
                    return;
                }
                this._getActiveState(path);
            });
    }

    _getActiveState(path) {
        this._bus.call(
            BUS_NAME, path, 'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', ['org.freedesktop.systemd1.Unit', 'ActiveState']),
            null, Gio.DBusCallFlags.NONE, -1, this._cancellable,
            (bus, res) => {
                try {
                    const [state] = bus.call_finish(res).recursiveUnpack();
                    this._setActive(state === 'active' || state === 'activating');
                } catch (e) {
                    // unit can be GC'd between GetUnit and this read
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        this._setActive(false);
                }
            });
    }

    _setActive(active) {
        this.active = active;
        this.toggle.checked = active;
        this._indicator.visible = active;
    }

    _toggleUnit() {
        if (this.toggle.checked)
            this._managerCall('StopUnit', new GLib.Variant('(ss)', [this._unit, 'replace']));
        else
            this._startUnit();
    }

    _startUnit(mayRetry = true) {
        // Same transient unit systemd-run would create: an inhibitor lock
        // held by a sleeping process, GC'd by systemd once it stops.
        const argv = this._buildArgv();
        if (!argv)
            return;
        this._managerCall('StartTransientUnit', new GLib.Variant('(ssa(sv)a(sa(sv)))', [
            this._unit, 'replace',
            [
                ['Description', new GLib.Variant('s', this._description)],
                ['CollectMode', new GLib.Variant('s', 'inactive-or-failed')],
                ['ExecStart', new GLib.Variant('a(sasb)', [[argv[0], argv, false]])],
            ],
            [],
        ]), e => {
            // A just-stopped instance can still be deactivating (or pending
            // GC) under the same name, which systemd rejects with UnitExists.
            // Retry once, after it is collected, so a quick off-then-on click
            // isn't silently dropped.
            if (mayRetry && this._startRetryId === 0 &&
                Gio.DBusError.get_remote_error(e) === 'org.freedesktop.systemd1.UnitExists') {
                this._startRetryId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
                    this._startRetryId = 0;
                    this._startUnit(false);
                    return GLib.SOURCE_REMOVE;
                });
                return true;
            }
            return false;
        });
    }

    destroy() {
        if (this._startRetryId) {
            GLib.source_remove(this._startRetryId);
            this._startRetryId = 0;
        }
        for (const id of this._signalIds)
            this._bus.signal_unsubscribe(id);
        this._signalIds = [];
        this.toggle.disconnectObject(this);
        this.toggle.destroy();
        this._indicator.destroy();
    }
}

const NosleepIndicator = GObject.registerClass(
class NosleepIndicator extends SystemIndicator {
    constructor(extensionObject) {
        super();

        const gicon = Gio.icon_new_for_string(
            `${extensionObject.path}/icons/nosleep-symbolic.svg`);
        // Keep Screen On gets a distinct, display-themed icon so the two
        // toggles — and their top-bar icons — read differently at a glance; a
        // bare name resolves to a themed icon from the active icon theme.
        const screenGicon = Gio.icon_new_for_string('video-display-symbolic');

        this._bus = Gio.DBus.session;
        this._cancellable = new Gio.Cancellable();

        // systemd only emits unit signals to explicit subscribers; one
        // Subscribe on the shared session connection covers both toggles
        this._bus.call(
            BUS_NAME, MANAGER_PATH, MANAGER_IFACE, 'Subscribe', null, null,
            Gio.DBusCallFlags.NONE, -1, this._cancellable,
            (bus, res) => {
                try {
                    bus.call_finish(res);
                } catch (e) {
                    // AlreadySubscribed is benign: the shell's shared session
                    // connection is subscribed process-wide (by us on a prior
                    // enable, or another consumer), so signals still flow — and
                    // we deliberately never Unsubscribe, which would drop it out
                    // from under those other users.
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) &&
                        Gio.DBusError.get_remote_error(e) !== 'org.freedesktop.systemd1.AlreadySubscribed')
                        console.warn(`nosleep: Subscribe failed: ${e.message}`);
                }
            });

        // Each toggle owns its own top-bar icon, added in Stay Awake then Keep
        // Screen On order so the panel lays them out left-to-right the same
        // way. There is no shared indicator: the panel is exactly the union of
        // the active inhibitors' icons.
        this._toggles = [
            new InhibitorToggle(this._bus, this._cancellable, {
                title: _('Stay Awake'),
                gicon,
                indicator: this._addIndicator(),
                unit: 'nosleep.service',
                description: 'Hold sleep/lid-switch inhibitor (nosleep)',
                // Resolved to absolute paths because ExecStart requires them.
                buildArgv: () => {
                    const inhibit = GLib.find_program_in_path('systemd-inhibit');
                    const sleep = GLib.find_program_in_path('sleep');
                    if (!inhibit || !sleep) {
                        console.error('nosleep: systemd-inhibit or sleep not found in PATH');
                        return null;
                    }
                    return [
                        inhibit,
                        '--what=sleep:handle-lid-switch',
                        '--mode=block',
                        '--who=nosleep',
                        '--why=user asked the machine to stay awake',
                        sleep, 'infinity',
                    ];
                },
            }),
            new InhibitorToggle(this._bus, this._cancellable, {
                title: _('Keep Screen On'),
                gicon: screenGicon,
                indicator: this._addIndicator(),
                unit: 'nosleep-screen.service',
                description: 'Hold idle inhibitor (nosleep)',
                // gnome-session-inhibit, not systemd-inhibit: gnome-shell's
                // idle timer (screen blank/lock) only honors GNOME session
                // inhibitors, not a logind idle lock. Absolute paths for
                // ExecStart; the inner sleep holds the inhibitor until stopped.
                buildArgv: () => {
                    const inhibit = GLib.find_program_in_path('gnome-session-inhibit');
                    const sleep = GLib.find_program_in_path('sleep');
                    if (!inhibit || !sleep) {
                        console.error('nosleep: gnome-session-inhibit or sleep not found in PATH');
                        return null;
                    }
                    return [
                        inhibit,
                        '--inhibit=idle',
                        '--app-id=nosleep',
                        '--reason=user asked to keep the screen on',
                        sleep, 'infinity',
                    ];
                },
            }),
        ];
        for (const toggle of this._toggles)
            this.quickSettingsItems.push(toggle.toggle);
    }

    // panel.js addExternalIndicator inserts our toggles before a sibling;
    // with no "background apps" item present that sibling is null, so each
    // insert lands at index 0 and the pushed order comes out reversed. Pin
    // it explicitly so Stay Awake always precedes Keep Screen On, in either
    // case (and across shell versions).
    pinItemOrder() {
        const [first, second] = this._toggles.map(toggle => toggle.toggle);
        const grid = first.get_parent();
        if (grid && second.get_parent() === grid)
            grid.set_child_below_sibling(first, second);
    }

    destroy() {
        this._cancellable.cancel();
        for (const toggle of this._toggles)
            toggle.destroy();
        this._toggles = [];
        super.destroy();
    }
});

export default class NosleepExtension extends Extension {
    enable() {
        this._indicator = new NosleepIndicator(this);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
        this._indicator.pinItemOrder();
    }

    disable() {
        // unlock-dialog (metadata.json): we stay enabled on the lock screen so
        // the toggles/indicator remain usable there. Safe to expose — the UI
        // only starts/stops inhibitors and reveals nothing — and destroy()
        // still fully tears the indicator down on real session teardown.
        this._indicator?.destroy();
        this._indicator = null;
    }
}
