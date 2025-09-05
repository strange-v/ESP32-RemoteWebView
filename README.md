> [!IMPORTANT]
>
> This repository is a **proof-of-concept**. A more [robust successor](https://github.com/strange-v/RemoteWebViewServer) is in active development.
>
> **Performance:** After switching to JPEG encoding and applying several optimizations, full-screen updates reach ~**9 FPS**.
>
> **Currently working on:** building and publishing a **Docker image for the server**.


# ESP32-RemoteWebView

  This is an experimental project that turns an ESP32-powered square LCD panel (e.g., Guition ESP32-S3-4848S040) into a remote web viewer for the Home Assistant dashboard (or any web page).
  
  Instead of building dashboards with LVGL or writing custom UI code, a headless Chromium instance runs on a server, renders your HA dashboard at a fixed resolution, and streams the result to the ESP32.  

- The server captures the page as images (split into tiles for efficiency) and sends only the changed regions over WebSocket.
- The ESP32 stitches and displays those tiles in real-time.  
- Touch events are sent back from the ESP32 to the server, which injects them into the browser via the Chrome DevTools Protocol (CDP).

[![Demo video](/doc/IMG-001.png)](https://youtu.be/a2_A2hpuuy4)
