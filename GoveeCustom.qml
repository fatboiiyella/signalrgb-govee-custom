import QtQuick.Layouts

/* Govee Custom — discovery/settings panel.
 * Minimal on purpose: the actual devices show up under SignalRGB's Devices
 * tab. This panel just reports scan status. Uses only service.controllers,
 * so it won't error regardless of controller shape. */

Item {
    anchors.fill: parent

    Column {
        width: parent.width
        spacing: 10

        Rectangle {
            height: 66
            width: 380
            radius: 8
            color: "#1e2327"

            Column {
                anchors.left: parent.left
                anchors.leftMargin: 14
                anchors.verticalCenter: parent.verticalCenter
                spacing: 3

                Text {
                    color: "white"
                    font.pixelSize: 15
                    text: service.controllers.length === 0
                        ? "Searching your network for Govee devices..."
                        : (service.controllers.length + " Govee device(s) found")
                }
                Text {
                    color: "#9AA0A6"
                    font.pixelSize: 12
                    text: "They appear under the Devices tab. First scan can take a minute."
                }
                Text {
                    color: "#9AA0A6"
                    font.pixelSize: 12
                    text: "LAN Control must be ON for each device in the Govee Home app."
                }
            }
        }
    }
}
