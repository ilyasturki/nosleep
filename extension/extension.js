// Quick Settings toggle + top-bar indicator for the nosleep inhibitor.
// Deliberately stateless: the systemd user unit is the single source of
// truth. Clicking only starts/stops the transient unit over D-Bus;
// `checked` and the indicator follow the real unit state, so the UI can
// never desync from (or lose) the inhibitor. The bundled nosleep CLI
// drives the same unit, so either side can stop what the other started.
//
// Runs in the unlock-dialog session mode too (see metadata.json), so the
// toggle and indicator stay on the lock screen — letting you confirm or
// flip stay-awake without unlocking. Safe to expose there: the UI only
// starts/stops a sleep inhibitor and reveals nothing.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {QuickToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';

const BUS_NAME = 'org.freedesktop.systemd1';
const MANAGER_PATH = '/org/freedesktop/systemd1';
const MANAGER_IFACE = 'org.freedesktop.systemd1.Manager';
const UNIT = 'nosleep.service';
// systemd's D-Bus escaping of "nosleep.service" is deterministic, so the
// path can be watched even while the transient unit does not exist
const UNIT_PATH = '/org/freedesktop/systemd1/unit/nosleep_2eservice';

const NosleepIndicator = GObject.registerClass(
class NosleepIndicator extends SystemIndicator {
    constructor(extensionObject) {
        super();

        const gicon = Gio.icon_new_for_string(
            `${extensionObject.path}/icons/nosleep-symbolic.svg`);

        this._icon = this._addIndicator();
        this._icon.gicon = gicon;
        this._icon.visible = false;

        // toggleMode off: a click must not flip `checked` optimistically,
        // only the unit-state refresh may
        this._toggle = new QuickToggle({
            title: _('Stay Awake'),
            gicon,
            toggleMode: false,
        });
        this._toggleClickedId = this._toggle.connect('clicked', () => this._toggleUnit());
        this.quickSettingsItems.push(this._toggle);

        this._bus = Gio.DBus.session;
        this._cancellable = new Gio.Cancellable();

        // systemd only emits unit signals to explicit subscribers
        this._managerCall('Subscribe', null);
        this._signalIds = [
            this._bus.signal_subscribe(
                BUS_NAME, 'org.freedesktop.DBus.Properties', 'PropertiesChanged',
                UNIT_PATH, null, Gio.DBusSignalFlags.NONE,
                () => this._refresh()),
            ...['UnitNew', 'UnitRemoved'].map(signal =>
                this._bus.signal_subscribe(
                    BUS_NAME, MANAGER_IFACE, signal,
                    MANAGER_PATH, null, Gio.DBusSignalFlags.NONE,
                    (conn, sender, path, iface, name, params) => {
                        if (params.deepUnpack()[0] === UNIT)
                            this._refresh();
                    })),
        ];

        this._refresh();
    }

    _managerCall(method, params) {
        this._bus.call(
            BUS_NAME, MANAGER_PATH, MANAGER_IFACE, method, params, null,
            Gio.DBusCallFlags.NONE, -1, this._cancellable,
            (bus, res) => {
                try {
                    bus.call_finish(res);
                    this._refresh();
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
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
            new GLib.Variant('(s)', [UNIT]), null,
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
        this._toggle.checked = active;
        this._icon.visible = active;
    }

    _toggleUnit() {
        if (this._toggle.checked)
            this._managerCall('StopUnit', new GLib.Variant('(ss)', [UNIT, 'replace']));
        else
            this._startUnit();
    }

    _startUnit() {
        // Same transient unit systemd-run would create: an inhibitor lock
        // held by a sleeping process, GC'd by systemd once it stops.
        // Resolved to absolute paths because ExecStart requires them.
        const inhibit = GLib.find_program_in_path('systemd-inhibit');
        const sleep = GLib.find_program_in_path('sleep');
        if (!inhibit || !sleep) {
            console.error('nosleep: systemd-inhibit or sleep not found in PATH');
            return;
        }
        const argv = [
            inhibit,
            '--what=sleep:handle-lid-switch',
            '--mode=block',
            '--who=nosleep',
            '--why=user asked the machine to stay awake',
            sleep, 'infinity',
        ];
        this._managerCall('StartTransientUnit', new GLib.Variant('(ssa(sv)a(sa(sv)))', [
            UNIT, 'replace',
            [
                ['Description', new GLib.Variant('s', 'Hold sleep/lid-switch inhibitor (nosleep)')],
                ['CollectMode', new GLib.Variant('s', 'inactive-or-failed')],
                ['ExecStart', new GLib.Variant('a(sasb)', [[argv[0], argv, false]])],
            ],
            [],
        ]));
    }

    destroy() {
        this._cancellable.cancel();
        for (const id of this._signalIds)
            this._bus.signal_unsubscribe(id);
        this._signalIds = [];
        this._managerCall = () => {};
        this._toggle.disconnect(this._toggleClickedId);
        this.quickSettingsItems.forEach(item => item.destroy());
        super.destroy();
    }
});

export default class NosleepExtension extends Extension {
    enable() {
        this._indicator = new NosleepIndicator(this);
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        // unlock-dialog (metadata.json): we stay enabled on the lock screen so
        // the toggle/indicator remain usable there. Safe to expose — the UI only
        // starts/stops a sleep inhibitor and reveals nothing — and destroy()
        // still fully tears the indicator down on real session teardown.
        this._indicator?.destroy();
        this._indicator = null;
    }
}
