#include <Arduino.h>
#include <LovyanGFX.hpp>
#include <LGFX.hpp>
#include <WiFi.h>
#include "esp_wifi.h"
#include <WebSocketsClient.h>
#include <PNGdec.h>

#define RDP_HOST "172.16.0.252"
#define RDP_PORT 8081
#define RDP_PATH "/"

static LGFX lcd;
WebSocketsClient ws;
PNG png;

struct DrawCtx
{
    int16_t x{0}, y{0};
};
static DrawCtx g_ctx;

static int pngDraw(PNGDRAW *pDraw)
{
    static uint16_t line[512];
    png.getLineAsRGB565(pDraw, line, 0, 0x000000);
    lcd.pushImageDMA(g_ctx.x, g_ctx.y + pDraw->y, pDraw->iWidth, 1, line);
    return 1;
}

static void wsSendTouchBin(uint8_t kind, uint16_t x, uint16_t y)
{
    uint8_t f[9];
    f[0] = 'T';
    f[1] = 'O';
    f[2] = 'U';
    f[3] = 'C';
    f[4] = kind;
    f[5] = x & 0xFF;
    f[6] = (x >> 8) & 0xFF; // LE
    f[7] = y & 0xFF;
    f[8] = (y >> 8) & 0xFF; // LE
    Serial.printf("[touch->ws] kind=%u x=%u y=%u\n", kind, x, y);
    ws.sendBIN(f, sizeof(f));
}

static void onWsEvent(WStype_t type, uint8_t *payload, size_t length)
{
    if (type == WStype_BIN)
    {
        if (length < 17)
            return;

        if (memcmp(payload, "TILE", 4) != 0)
            return;
        uint8_t enc = payload[4];
        uint16_t x = *(uint16_t *)(payload + 5);
        uint16_t y = *(uint16_t *)(payload + 7);
        uint16_t w = *(uint16_t *)(payload + 9);
        uint16_t h = *(uint16_t *)(payload + 11);
        uint32_t data_len = *(uint32_t *)(payload + 13);
        if (17 + data_len != length)
            return;

        g_ctx.x = x;
        g_ctx.y = y;
        if (enc == 0)
        { // PNG
            uint8_t *data = payload + 17;
            if (png.openRAM(data, data_len, pngDraw) == PNG_SUCCESS)
            {
                png.decode(NULL, 0);
                png.close();
            }
        }

        ws.loop();
        yield();
    }
    else if (type == WStype_TEXT)
    {
    }
    else if (type == WStype_CONNECTED)
    {
        Serial.println(F("[ws] connected"));
    }
    else if (type == WStype_DISCONNECTED)
    {
        Serial.println(F("[ws] disconnected"));
    }
}

static void pollTouch()
{
    static bool wasDown = false;
    static int16_t px = -1, py = -1;

    uint16_t x, y;
    bool isDown = lcd.getTouch(&x, &y);

    if (isDown && !wasDown)
    {
        wsSendTouchBin(0, x, y); // down
        px = x;
        py = y;
    }
    else if (isDown && wasDown)
    {
        if (abs((int)x - (int)px) + abs((int)y - (int)py) >= 3)
        {
            wsSendTouchBin(1, x, y); // move
            px = x;
            py = y;
        }
    }
    else if (!isDown && wasDown)
    {
        wsSendTouchBin(2, px, py); // up
    }
    wasDown = isDown;
}

static void connectWiFi()
{
    WiFi.mode(WIFI_STA);
    esp_wifi_set_ps(WIFI_PS_NONE);
    WiFi.begin(WIFI_SSID, WIFI_PWD);
    Serial.printf("WiFi connecting to %s", WIFI_SSID);
    uint32_t t0 = millis();
    while (WiFi.status() != WL_CONNECTED)
    {
        Serial.print('.');
        delay(500);
        if (millis() - t0 > 20000)
            break;
    }
    Serial.printf("\nWiFi %s, ip: %s\n", WiFi.status() == WL_CONNECTED ? "OK" : "FAIL", WiFi.localIP().toString().c_str());
}

void setup(void)
{
    Serial.begin(115200);
    delay(500);

    Serial.println("Starting...");
    if (lcd.init())
    {
        Serial.println("Init OK");
    }

    lcd.setSwapBytes(true);
    lcd.setRotation(0);
    lcd.fillScreen(TFT_BLACK);
    lcd.setTextColor(TFT_WHITE, TFT_BLACK);
    lcd.setTextDatum(textdatum_t::middle_center);
    lcd.drawString("Connecting WiFi...", lcd.width() / 2, lcd.height() / 2);

    connectWiFi();

    lcd.fillScreen(TFT_BLACK);
    lcd.drawString("Connecting WS...", lcd.width() / 2, lcd.height() / 2);

    ws.begin(RDP_HOST, RDP_PORT, RDP_PATH); // ws://HOST:PORT/
    ws.onEvent(onWsEvent);
    ws.setReconnectInterval(2000);
    ws.enableHeartbeat(15000, 3000, 2); // keepalive

    lcd.setBrightness(150);
}

uint32_t lastTouch = 0;

void loop()
{
    ws.loop();

    uint32_t now = millis();
    if (now - lastTouch >= 15)
    {
        pollTouch();
        lastTouch = now;
    }
}