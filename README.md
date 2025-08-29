# ESP32-RemoteWebView

  ESP32-RemoteWebView is an experimental project that turns an ESP32-powered square LCD panel (e.g., Guition ESP32-S3-4848S040) into a remote web viewer for the Home Assistant dashboard (or any web page).
  
  Instead of building dashboards with LVGL or writing custom UI code, a headless Chromium instance runs on a server, renders your HA dashboard at a fixed resolution, and streams the result to the ESP32.  

- The server captures the page as images (split into tiles for efficiency) and sends only the changed regions over WebSocket.
- The ESP32 stitches and displays those tiles in real-time.  
- Touch events are sent back from the ESP32 to the server, which injects them into the browser via the Chrome DevTools Protocol (CDP).
