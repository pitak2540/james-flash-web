# JAMES Flash — Web / Android (PWA)

Honda ECU K-line reader/flasher that runs in the browser. Connects to an FTDI K-line
cable over **WebUSB** (USB-OTG on Android), using the same protocol code as the desktop app.

- **Live app:** https://pitak2540.github.io/james-flash-web/
- **Android APK:** see the latest [Release](../../releases) (built from this repo by CI)

Open on Chrome/Edge (desktop) or Chrome on Android → "ติดตั้งแอป" / Install → plug in the
FTDI cable via OTG → **เชื่อมต่อ ECM**.

WebUSB needs HTTPS (GitHub Pages provides it). CAN (ELM327/SM2) and Renesas are desktop-only for now.
