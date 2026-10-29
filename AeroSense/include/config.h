#pragma once
#include <Arduino.h>

// ==============================================================================
// AeroSense Hardware Configuration & Pin Mapping
// ==============================================================================

// Display Configuration (1.3" 128x64 I2C OLED)
// Most 1.3" OLEDs use the SH1106 controller; 0.96" use SSD1306.
#define USE_SH1106              1   // Set to 1 for SH1106 (1.3" OLED), or 0 for SSD1306
#define SCREEN_WIDTH            128
#define SCREEN_HEIGHT           64
#define OLED_RESET              -1
#define OLED_I2C_ADDRESS        0x3C

// I2C Pins for ESP32
#define I2C_SDA_PIN             21
#define I2C_SCL_PIN             22

// BMP280 Sensor I2C Address (GY-BMP280 typically 0x76 or 0x77)
#define BMP280_ADDR_PRIMARY     0x76
#define BMP280_ADDR_SECONDARY   0x77

// SD Card SPI Pins (User Specified - Soldered on Custom PCB)
#define SPI_SCK_PIN             18
#define SPI_MISO_PIN            19
#define SPI_MOSI_PIN            23
#define SD_CS                   13  // Original PCB connection preserved

// Navigation Buttons (Soldered on Custom PCB)
#define BUTTON_PIN_UP           26
#define BUTTON_PIN_DOWN         33  // Soldered on custom PCB
#define BUTTON_PIN_CENTER       32  // Exit / Home
#define BUTTON_PIN_LEFT         25  // Back
#define BUTTON_PIN_RIGHT        27  // Select

// 3x Dedicated SMD Status & Strobe LEDs (Pins 2, 12, 14)
// ============================================================
//   WHITE SMD LED  (GPIO 2)  -> Flashes "Aero Beacon" on device power-up
//   GREEN SMD LED  (GPIO 12) -> Flashes "Exec Triple" when BMP280 sensor is detected
//   ORANGE SMD LED (GPIO 14) -> Flashes "Stealth" on device power-up
// ============================================================
#define SMD_LED_WHITE_PIN       2   // White SMD LED  (Power-Up: Aero Beacon)
#define SMD_LED_GREEN_PIN       12  // Green SMD LED  (BMP280 Detected: Exec Triple)
#define SMD_LED_ORANGE_PIN      14  // Orange SMD LED (Power-Up: Stealth Burst)

// GPS NEO-6M Hardware UART Configuration (Original PCB Connections Preserved)
// ============================================================
//   - Buttons (PCB): 25, 26, 27, 32, 33 (UNTOUCHED)
//   - I2C (PCB):     21, 22 (UNTOUCHED)
//   - SD Card (PCB): 18, 19, 23, 13 (UNTOUCHED)
//   - SMD LEDs:      2 (White), 12 (Green), 14 (Orange)
//   - GPS Module:    RX = GPIO 34 (Receive-only so GPIO 14 is dedicated to Orange SMD LED)
// ============================================================
#define GPS_RX_PIN              34  // ESP32 RX <- NEO-6M TX
#define GPS_TX_PIN              -1  // Disabled (-1) so GPIO 14 is dedicated to Orange SMD LED
#define GPS_BAUD_RATE           9600
#define GPS_UART_PORT           2   // ESP32 Hardware UART 2

// Airplane Anti-Collision Strobe LED (Mapped to White SMD LED on GPIO 2)
#define STROBE_LED_PIN          SMD_LED_WHITE_PIN

// Logging & Sampling Timing
#define SENSOR_SAMPLE_INTERVAL_MS 1000   // Sample sensor every 1 second
#define SD_LOG_INTERVAL_MS        5000   // Log to SD card every 5 seconds
#define CSV_FILE_PATH             "/aerosense.csv"

// Atmospheric & Precision Hypsometric Constants
#define STANDARD_SEA_LEVEL_HPA        1013.25f
#define DEFAULT_STATION_ELEVATION_M   920.0f    // Default ground elevation (m), customizable via OLED & Web Serial
#define HYPSOMETRIC_LAPSE_RATE        0.0065f   // Standard tropospheric lapse rate (K/m)
#define HYPSOMETRIC_EXPONENT          0.190263f // (R * L) / g exact constant

// Internet Meteorological Calibration & Sync Defaults
// Syncing true regional sea-level pressure (QNH) via Open-Meteo eliminates altitude drift
#define DEFAULT_LATITUDE              "12.9716" // Default Station Latitude
#define DEFAULT_LONGITUDE             "77.5946" // Default Station Longitude
#define OPEN_METEO_API_URL            "https://api.open-meteo.com/v1/forecast"
