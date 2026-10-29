
import udp from "@SignalRGB/udp";

export function Name() { return "Govee"; }
export function Version() { return "1.0.3-H61C3"; }
export function Type() { return "network"; }
export function Publisher() { return "WhirlwindFX"; }
export function Size() { return [22, 1]; }
export function SubdeviceController() { return true; }

export function ControllableParameters() {
    return [
        {
            property: "shutdownColor",
            group: "lighting",
            label: "Shutdown Color",
            type: "color",
            default: "#000000"
        },
        {
            property: "LightingMode",
            group: "lighting",
            label: "Lighting Mode",
            type: "combobox",
            values: ["Canvas", "Forced"],
            default: "Canvas"
        },
        {
            property: "forcedColor",
            group: "lighting",
            label: "Forced Color",
            type: "color",
            default: "#009bde"
        },
        {
            property: "TurnOffOnShutdown",
            group: "settings",
            label: "Turn off on unlink",
            type: "boolean",
            default: false
        },
        {
            property: "protocolSelect",
            group: "settings",
            label: "Protocol",
            type: "combobox",
            values: [
                "Auto",
                "Dreamview",
                "RazerV1",
                "RazerV2",
                "Static"
            ],
            default: "Auto"
        },
        {
            property: "blendSegments",
            group: "settings",
            label: "Blend Between Segments",
            type: "combobox",
            values: ["Auto", "On", "Off"],
            default: "Auto"
        }
    ];
}

let govee;
let UDPServer;

let channels = [];
let autoProtocol = "Static";
let loggedFirstFrame = false;
let renderCount = 0;
let sawConnectedSocket = false;
let loggedMissingProtocol = false;
let blendByDefault = true;
let activeOutputProtocol = null;
let streamingReadyAt = 0;

const UnknownSkuLedCount = 120;

export function Initialize() {
    loggedFirstFrame = false;
    renderCount = 0;
    sawConnectedSocket = false;
    activeOutputProtocol = null;
    streamingReadyAt = 0;
    loggedMissingProtocol = false;
    govee = undefined;

    device.addFeature("base64");
    device.setName(controller.sku);
    device.setImageFromUrl(controller.deviceImage);

    if (UDPServer !== undefined) {
        UDPServer.stop();
        UDPServer = undefined;
    }

    UDPServer = new UdpSocketServer({
        ip: controller.ip,
        broadcastPort: 4003
    });

    UDPServer.start();

    fetchDeviceInfoFromTableAndConfigure();

    govee = new GoveeProtocol(
        controller.ip,
        controller.supportDreamView,
        controller.supportRazer
    );
}

export function Render() {
    if (govee === undefined) {
        if (!loggedMissingProtocol) {
            loggedMissingProtocol = true;
            device.log(
                "Render called before Govee initialized."
            );
        }
        return;
    }

    if (
        UDPServer === undefined ||
        !UDPServer.connected
    ) {
        device.pause(10);
        return;
    }

    const now = Date.now();

    if (!sawConnectedSocket) {
        sawConnectedSocket = true;
        govee.setDeviceState(true);
        streamingReadyAt = now + 200;
        device.pause(10);
        return;
    }

    if (now < streamingReadyAt) {
        device.pause(10);
        return;
    }

    const selectedProtocol =
        protocolSelect === "Auto"
            ? autoProtocol
            : protocolSelect;

    if (
        selectedProtocol !== activeOutputProtocol
    ) {
        if (selectedProtocol === "Static") {
            govee.SetStreamingMode(false);
        } else {
            govee.SetStreamingMode(true);
        }

        activeOutputProtocol = selectedProtocol;
        streamingReadyAt = now + 200;

        device.log(
            `Govee output protocol: ${selectedProtocol}`
        );

        device.pause(10);
        return;
    }

    renderCount++;
    govee.SendRGB();

    device.pause(
        selectedProtocol === "Static" ? 10 : 40
    );
}

export function Shutdown(SystemSuspending) {
    if (govee === undefined) {
        return;
    }

    if (
        activeOutputProtocol !== "Static" &&
        activeOutputProtocol !== null
    ) {
        govee.SetStreamingMode(false);
    }

    if (TurnOffOnShutdown) {
        govee.setDeviceState(false);
        return;
    }

    const color =
        SystemSuspending
            ? "#000000"
            : shutdownColor;

    govee.SendStaticColor(
        device.createColorArray(
            color,
            1,
            "Inline"
        )
    );
}

function fetchDeviceInfoFromTableAndConfigure() {
    if (
        !GoveeDeviceLibrary.hasOwnProperty(
            controller.sku
        )
    ) {
        device.log(
            `Unknown Govee SKU: ${controller.sku}`
        );

        autoProtocol = "Static";

        ConfigureChannels([
            {
                name: "Channel 1",
                ledCount: UnknownSkuLedCount
            }
        ]);

        return;
    }

    const info =
        GoveeDeviceLibrary[controller.sku];

    blendByDefault =
        info.blendSegments ?? true;

    device.setName(
        `Govee ${info.sku} - ${info.name}`
    );

    autoProtocol = GetAutoProtocol(info);

    device.log(
        `Auto protocol: ${autoProtocol}`
    );

    ConfigureChannels(GetChannelLayout(info));
}

function GetAutoProtocol(info) {
    if (info.supportDreamView) {
        return "Dreamview";
    }

    if (info.supportRazer) {
        return "RazerV1";
    }

    return "Static";
}

function ShouldBlend() {
    if (blendSegments === "On") {
        return true;
    }

    if (blendSegments === "Off") {
        return false;
    }

    return blendByDefault;
}

function GetChannelLayout(info) {
    if (info.usesSubDevices) {
        return info.subdevices.map(
            (subdevice, index) => ({
                name: `Channel ${index + 1}`,
                ledCount: subdevice.ledCount
            })
        );
    }

    return [
        {
            name: "Channel 1",
            ledCount: info.ledCount
        }
    ];
}

function ConfigureChannels(layout) {
    channels = layout;

    let totalLedCount = 0;

    for (const channel of channels) {
        device.addChannel(
            channel.name,
            channel.ledCount
        );

        device.channel(
            channel.name
        ).SetLedLimit(channel.ledCount);

        totalLedCount += channel.ledCount;
    }

    device.SetLedLimit(totalLedCount);
}

// ==========================================
// Discovery service
// ==========================================

export function DiscoveryService() {
    this.IconUrl =
        "https://assets.signalrgb.com/brands/govee/logo.png";

    this.firstRun = true;

    this.Initialize = function () {
        service.log(
            "Searching for Govee network devices..."
        );
    };

    this.UdpBroadcastPort = 4001;
    this.UdpListenPort = 4002;
    this.UdpBroadcastAddress =
        "239.255.255.250";

    this.lastPollTime = 0;
    this.PollInterval = 60000;

    this.cache = new IPCache();
    this.activeSockets = new Map();
    this.activeSocketTimer = Date.now();

    this.LoadCachedDevices = function () {
        for (const [key, value] of this.cache.Entries()) {
            this.CreateControllerDevice(value);
            this.checkCachedDevice(value.ip);

            if (value.paired !== false) {
                this.link(value);
            }
        }
    };

    this.checkCachedDevice = function (ipAddress) {
        if (UDPServer !== undefined) {
            UDPServer.stop();
            UDPServer = undefined;
        }

        const socketServer = new UdpSocketServer({
            ip: ipAddress,
            isDiscoveryServer: true
        });

        this.activeSockets.set(
            ipAddress,
            socketServer
        );

        this.activeSocketTimer = Date.now();
        socketServer.start();
    };

    this.clearSockets = function () {
        if (
            Date.now() - this.activeSocketTimer > 10000 &&
            this.activeSockets.size > 0
        ) {
            for (
                const [key, value]
                of this.activeSockets.entries()
            ) {
                value.stop();
                this.activeSockets.delete(key);
            }
        }
    };

    this.CheckForDevices = function () {
        if (
            Date.now() - discovery.lastPollTime <
            discovery.PollInterval
        ) {
            return;
        }

        discovery.lastPollTime = Date.now();

        service.broadcast(
            JSON.stringify({
                msg: {
                    cmd: "scan",
                    data: {
                        account_topic: "reserve"
                    }
                }
            })
        );
    };

    this.Discovered = function (value) {
        const response =
            JSON.parse(value.response);

        if (response.msg.cmd !== "scan") {
            return;
        }

        if (
            !response.msg.data.hasOwnProperty("ip")
        ) {
            return;
        }

        this.CreateControllerDevice(value);
    };

    this.forceDiscovery = function (value) {
        this.Discovered(value);
    };

    this.purgeIPCache = function () {
        this.cache.PurgeCache();
    };

    this.Update = function () {
        if (this.firstRun) {
            this.LoadCachedDevices();
            this.firstRun = false;
        }

        for (const cont of service.controllers) {
            cont.obj.update();
        }

        this.clearSockets();
        this.CheckForDevices();
    };

    this.getSocket = function (key) {
        return this.activeSockets.get(key);
    };

    this.Shutdown = function () {};

    this.remove = function (controllerObj = false) {
        if (controllerObj) {
            const udpSocket =
                this.getSocket(controllerObj.ip);

            if (udpSocket) {
                udpSocket.stop();
                this.activeSockets.delete(
                    controllerObj.ip
                );
            }

            this.cache.Remove(controllerObj.id);

            service.suppressController(
                controllerObj
            );

            service.removeController(
                controllerObj
            );
        } else {
            this.cache.PurgeCache();

            for (
                const [key, value]
                of this.cache.Entries()
            ) {
                service.suppressController(value);
                service.removeController(value);
            }
        }
    };

    this.CreateControllerDevice = function (value) {
        const controller =
            service.getController(value.id);

        if (controller === undefined) {
            service.addController(
                new GoveeController(value)
            );
        } else {
            controller.updateWithValue(value);
        }
    };

    this.link = function (controllerObj) {
        const controller =
            service.getController(controllerObj.id);

        if (controller === undefined) {
            return;
        }

        controller.paired = true;
        controller.updateWithValue(controller);
        service.announceController(controller);

        this.cacheControllerInfo(controller);
    };

    this.unlink = function (controllerObj) {
        const controller =
            service.getController(controllerObj.id);

        if (controller === undefined) {
            return;
        }

        const udpSocket =
            this.getSocket(controllerObj.ip);

        if (udpSocket) {
            udpSocket.stop();
            this.activeSockets.delete(
                controllerObj.ip
            );
        }

        controller.paired = false;
        controller.updateWithValue(controller);
        service.suppressController(controller);

        this.cacheControllerInfo(controller);
    };

    this.cacheControllerInfo = function (value) {
        discovery.cache.Add(value.id, {
            id: value.id,
            paired: value.paired,
            ip: value.ip,
            name: value.sku,
            GoveeInfo: value.GoveeInfo,
            supportDreamView:
                value.GoveeInfo.supportDreamView,
            supportRazer:
                value.GoveeInfo.supportRazer,
            deviceImage:
                value.GoveeInfo.deviceImage,
            device: value.device,
            sku: value.sku,
            initialized: value.initialized
        });
    };
}

// ==========================================
// Device controller
// ==========================================

class GoveeController {
    constructor(value) {
        this.id = value?.id ?? "Unknown ID";

        this.paired =
            value?.paired ??
            discovery.cache.Get(this.id)?.paired ??
            false;

        let response;

        if (value.response) {
            response =
                JSON.parse(value.response).msg.data;
        } else {
            response = value;
        }

        this.ip =
            response?.ip ?? "Unknown IP";

        this.name =
            response?.sku ?? "Unknown SKU";

        this.GoveeInfo =
            this.GetGoveeDevice(response.sku);

        this.supportDreamView =
            this.GoveeInfo.supportDreamView;

        this.supportRazer =
            this.GoveeInfo.supportRazer;

        this.deviceImage =
            this.GoveeInfo.deviceImage;

        this.device = response.device;
        this.sku = response.sku;
        this.initialized = false;

        if (this.name !== "Unknown SKU") {
            this.cacheControllerInfo(this);
        }
    }

    GetGoveeDevice(sku) {
        if (
            GoveeDeviceLibrary.hasOwnProperty(sku)
        ) {
            return GoveeDeviceLibrary[sku];
        }

        return {
            name: "Unknown",
            supportDreamView: false,
            supportRazer: false,
            deviceImage:
                "https://assets.signalrgb.com/brands/products/govee_ble/icon@2x.png"
        };
    }

    updateWithValue(value) {
        this.id = value.id;
        this.paired =
            value.paired ?? this.paired;

        let response;

        if (value.response) {
            response =
                JSON.parse(value.response).msg.data;
        } else {
            response = value;
        }

        this.ip =
            response?.ip ?? this.ip;

        this.device = response.device;
        this.sku = response.sku;

        service.updateController(this);
    }

    update() {
        if (!this.initialized) {
            this.initialized = true;
            service.updateController(this);
            service.announceController(this);
        }
    }

    cacheControllerInfo(value) {
        discovery.cache.Add(value.id, {
            id: value.id,
            paired: value.paired,
            ip: value.ip,
            name: value.sku,
            GoveeInfo: value.GoveeInfo,
            supportDreamView:
                value.GoveeInfo.supportDreamView,
            supportRazer:
                value.GoveeInfo.supportRazer,
            deviceImage:
                value.GoveeInfo.deviceImage,
            device: value.device,
            sku: value.sku,
            initialized: value.initialized
        });
    }
}

// ==========================================
// Lighting protocol
// ==========================================

class GoveeProtocol {
    constructor(ip, supportDreamView, supportRazer) {
        this.ip = ip;
        this.port = 4003;
        this.supportDreamView = supportDreamView;
        this.supportRazer = supportRazer;
    }

    setDeviceState(on) {
        UDPServer.send(
            JSON.stringify({
                msg: {
                    cmd: "turn",
                    data: {
                        value: on ? 1 : 0
                    }
                }
            })
        );
    }

    SetStreamingMode(enable) {
        UDPServer.send(
            JSON.stringify({
                msg: {
                    cmd: "razer",
                    data: {
                        pt: enable
                            ? "uwABsQEK"
                            : "uwABsQAL"
                    }
                }
            })
        );
    }

    calculateXorChecksum(packet) {
        let checksum = 0;

        for (const byte of packet) {
            checksum ^= byte;
        }

        return checksum;
    }

    createDreamViewPacket(colors, mode = 0x00) {
        const payload = [
            mode & 0xff,
            colors.length / 3
        ].concat(colors);

        const header = [
            0xBB,
            (payload.length >> 8) & 0xff,
            payload.length & 0xff,
            0xB0
        ];

        const packet = header.concat(payload);

        packet.push(
            this.calculateXorChecksum(packet)
        );

        return packet;
    }

    createRazerPacketV1(colors) {
        const packet = [
            0xBB,
            0x00,
            0x0E,
            0xB0,
            0x01,
            colors.length / 3
        ].concat(colors);

        packet.push(0);
        return packet;
    }

    createRazerPacketV2(colors) {
        const packet = [
            0xBB,
            0x00,
            0x0E,
            0xB0,
            0x01,
            colors.length
        ].concat(colors);

        packet.push(
            this.calculateXorChecksum(packet)
        );

        return packet;
    }

    SendStaticColor(rgb) {
        UDPServer.send(
            JSON.stringify({
                msg: {
                    cmd: "colorwc",
                    data: {
                        color: {
                            r: rgb[0],
                            g: rgb[1],
                            b: rgb[2]
                        },
                        colorTemInKelvin: 0
                    }
                }
            })
        );
    }

    SetStaticColor(rgb) {
        this.SendStaticColor(rgb);
        device.pause(100);
    }

    SendEncodedPacket(packet) {
        const command = base64.Encode(packet);

        if (!loggedFirstFrame) {
            loggedFirstFrame = true;
            device.log(
                `Streaming started: ${packet.length} bytes`
            );
        }

        UDPServer.send(
            JSON.stringify({
                msg: {
                    cmd: "razer",
                    data: {
                        pt: command
                    }
                }
            })
        );
    }

    GetChannelRGB(channelName, overrideColor) {
        const channel =
            device.channel(channelName);

        const count = channel.LedCount();

        if (overrideColor) {
            return device.createColorArray(
                overrideColor,
                count,
                "Inline"
            );
        }

        if (LightingMode === "Forced") {
            return device.createColorArray(
                forcedColor,
                count,
                "Inline"
            );
        }

        if (channel.shouldPulseColors()) {
            return device.createColorArray(
                device.getChannelPulseColor(channelName),
                channel.LedLimit(),
                "Inline"
            );
        }

        return channel.getColors("Inline");
    }

    SendRGB(overrideColor) {
        let RGBData = [];

        for (const channel of channels) {
            RGBData = RGBData.concat(
                this.GetChannelRGB(
                    channel.name,
                    overrideColor
                )
            );
        }

        const selected =
            protocolSelect === "Auto"
                ? autoProtocol
                : protocolSelect;

        let packet;

        switch (selected) {
            case "Dreamview":
                packet = this.createDreamViewPacket(
                    RGBData,
                    ShouldBlend() ? 0x01 : 0x00
                );
                this.SendEncodedPacket(packet);
                break;

            case "RazerV1":
                packet = this.createRazerPacketV1(
                    RGBData
                );
                this.SendEncodedPacket(packet);
                break;

            case "RazerV2":
                packet = this.createRazerPacketV2(
                    RGBData
                );
                this.SendEncodedPacket(packet);
                break;

            case "Static":
                this.SetStaticColor(
                    RGBData.slice(0, 3)
                );
                break;

            default:
                this.SetStaticColor(
                    RGBData.slice(0, 3)
                );
                break;
        }
    }
}

// ==========================================
// UDP transport
// ==========================================

class UdpSocketServer {
    constructor(args) {
        this.server = null;

        this.listenPort =
            args?.listenPort ?? 0;

        this.broadcastPort =
            args?.broadcastPort ?? 4001;

        this.ipToConnectTo =
            args?.ip ?? "239.255.255.250";

        this.isDiscoveryServer =
            args?.isDiscoveryServer ?? false;

        this.connected = false;

        this.log = (msg) => {
            if (this.isDiscoveryServer) {
                service.log(msg);
            } else {
                device.log(msg);
            }
        };
    }

    send(packet) {
        if (!this.server) {
            this.server = udp.createSocket();
        }

        this.server.send(packet);
    }

    start() {
        this.server = udp.createSocket();

        this.server.on(
            "error",
            this.onError.bind(this)
        );

        this.server.on(
            "message",
            this.onMessage.bind(this)
        );

        this.server.on(
            "listening",
            this.onListening.bind(this)
        );

        this.server.on(
            "connection",
            this.onConnection.bind(this)
        );

        this.server.bind(this.listenPort);

        this.server.connect(
            this.ipToConnectTo,
            this.broadcastPort
        );
    }

    stop() {
        this.connected = false;

        if (this.server) {
            this.server.disconnect();
            this.server.close();
        }
    }

    onConnection() {
        this.connected = true;

        if (this.isDiscoveryServer) {
            this.server.send(
                JSON.stringify({
                    msg: {
                        cmd: "scan",
                        data: {
                            account_topic: "reserve"
                        }
                    }
                })
            );
        }
    }

    onListening() {
        const address = this.server.address();

        this.log(
            `Socket listening: ${address.port}`
        );
    }

    onMessage(msg) {
        if (this.isDiscoveryServer) {
            discovery.forceDiscovery(msg);
            this.server.close();
        }
    }

    onError(code, message) {
        this.log(
            `UDP error: ${code} - ${message}`
        );

        this.server.close();
    }
}

// ==========================================
// Device cache
// ==========================================

class IPCache {
    constructor() {
        this.cacheMap = new Map();
        this.persistanceId = "ipCache";
        this.persistanceKey = "cache";

        this.PopulateCacheFromStorage();
    }

    Add(key, value) {
        this.cacheMap.set(key, value);
        this.Persist();
    }

    Remove(key) {
        this.cacheMap.delete(key);
        this.Persist();
    }

    Has(key) {
        return this.cacheMap.has(key);
    }

    Get(key) {
        return this.cacheMap.get(key);
    }

    Entries() {
        return this.cacheMap.entries();
    }

    PurgeCache() {
        service.removeSetting(
            this.persistanceId,
            this.persistanceKey
        );

        this.cacheMap.clear();
    }

    PopulateCacheFromStorage() {
        const storage = service.getSetting(
            this.persistanceId,
            this.persistanceKey
        );

        if (!storage) {
            return;
        }

        try {
            this.cacheMap = new Map(
                JSON.parse(storage)
            );
        } catch (e) {
            service.log(
                "Invalid cached device list."
            );
        }
    }

    Persist() {
        service.saveSetting(
            this.persistanceId,
            this.persistanceKey,
            JSON.stringify(
                Array.from(this.cacheMap.entries())
            )
        );
    }
}

// ==========================================
// H61C3 device profile
// ==========================================

const GoveeDeviceLibrary = {
    H61C3: {
        name: "RGBIC LED Neon Rope Lights for Desks",
        deviceImage:
            "https://assets.signalrgb.com/devices/brands/govee/wifi/h61c2.png",
        sku: "H61C3",
        state: 1,
        supportRazer: true,
        supportDreamView: true,
        ledCount: 42
    }
};
