#include <Arduino.h>
#include <Wire.h>
#include <SPI.h>
#include <FS.h>
#include <SD.h>
#include <Preferences.h>
#include <Adafruit_GFX.h>
#include "config.h"

// Conditional Display Driver Selection
#if USE_SH1106
  #include <Adafruit_SH110X.h>
  Adafruit_SH1106G display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
#else
  #include <Adafruit_SSD1306.h>
  Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);
#endif

#include <Adafruit_BMP280.h>
#include <TinyGPSPlus.h>

// GPS NEO-6M Hardware UART & Parser
TinyGPSPlus gps;
HardwareSerial SerialGPS(GPS_UART_PORT);

struct GPSData {
  double latitude = 0.0;
  double longitude = 0.0;
  float gpsAltitude = 0.0f;
  float speedKmh = 0.0f;
  uint8_t satellites = 0;
  float hdop = 99.9f;
  bool fixValid = false;
  bool detected = false;
  uint32_t lastFixTime = 0;
  uint32_t lastByteTime = 0;
  uint32_t totalBytesReceived = 0;
  uint32_t sentencesParsed = 0;
  uint32_t detectedBaud = GPS_BAUD_RATE;
  uint8_t activeRxPin = GPS_RX_PIN;
  int8_t activeTxPin = GPS_TX_PIN;
  bool savedToFlash = false;
};

GPSData currentGps;
uint32_t lastGpsNvsSaveTime = 0;
uint32_t lastGpsRetryTime = 0;

// ==============================================================================
// 16x16 Aesthetic Weather Bitmaps (Aviation High-Contrast Monochrome)
// ==============================================================================
static const unsigned char PROGMEM icon_sun[] = {
  0x01, 0x80, 0x01, 0x80, 0x10, 0x08, 0x08, 0x10,
  0x07, 0xe0, 0x0f, 0xf0, 0x1f, 0xf8, 0x1f, 0xf8,
  0x1f, 0xf8, 0x1f, 0xf8, 0x0f, 0xf0, 0x07, 0xe0,
  0x08, 0x10, 0x10, 0x08, 0x01, 0x80, 0x01, 0x80
};

static const unsigned char PROGMEM icon_cloud[] = {
  0x00, 0x00, 0x00, 0x00, 0x03, 0xc0, 0x0c, 0x30,
  0x10, 0x08, 0x20, 0x04, 0x20, 0x04, 0x40, 0x02,
  0x80, 0x01, 0x80, 0x01, 0x80, 0x01, 0x40, 0x02,
  0x7f, 0xfe, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
};

static const unsigned char PROGMEM icon_rain[] = {
  0x03, 0xc0, 0x0c, 0x30, 0x10, 0x08, 0x20, 0x04,
  0x40, 0x02, 0x80, 0x01, 0x7f, 0xfe, 0x00, 0x00,
  0x24, 0x48, 0x48, 0x90, 0x12, 0x24, 0x24, 0x48,
  0x48, 0x90, 0x12, 0x24, 0x00, 0x00, 0x00, 0x00
};

static const unsigned char PROGMEM icon_storm[] = {
  0x07, 0xc0, 0x1f, 0xf0, 0x3c, 0x3c, 0x78, 0x0e,
  0xff, 0xff, 0xff, 0xff, 0x7f, 0xfe, 0x07, 0x00,
  0x0e, 0x00, 0x1f, 0xc0, 0x03, 0x80, 0x07, 0x00,
  0x0e, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00
};

// ==============================================================================
// Global Objects & State Variables
// ==============================================================================

Adafruit_BMP280 bmp(&Wire);
SPIClass sdSPI(VSPI);
Preferences preferences;

// Precision Atmospheric & Altimeter Data (100% Authentic Sensor Readings)
struct SensorData {
  float temperature = NAN;          // Celsius (Real BMP280 reading)
  float rawPressure = NAN;          // Instantaneous raw barometric pressure (hPa)
  float filteredPressure = NAN;     // Low-pass filtered barometric pressure (hPa)
  float pressure = NAN;             // Barometric pressure (hPa)
  float altitude = NAN;             // Temperature-compensated hypsometric altitude (m)
  float seaLevelPressure = STANDARD_SEA_LEVEL_HPA; // Calibrated QNH reference (hPa)
  float stationElevation = DEFAULT_STATION_ELEVATION_M; // Calibrated ground elevation (m)
  float pressureTrend = 0.0f;       // Barometric rate of change (hPa/hr)
  const char* weatherCondition = "CALIBRATING";
  bool sensorOk = false;
  uint8_t i2cAddress = 0;
  uint8_t detectedChipId = 0;
};

SensorData currentData;

// Pressure History Buffer for Tendency Rate Calculation (Last 12 samples: 2 minutes)
#define PRESSURE_TREND_BUF_SIZE 12
float pressureTrendBuf[PRESSURE_TREND_BUF_SIZE];
uint8_t pressureTrendCount = 0;
uint8_t pressureTrendIdx = 0;
uint32_t lastPressureTrendTime = 0;

// SD Card Status & Counters
bool sdAvailable = false;
uint32_t totalRecordsLogged = 0;
uint32_t lastLogTime = 0;
uint32_t lastSampleTime = 0;
uint32_t lastSensorRetryTime = 0;
uint32_t lastSerialStreamTime = 0;
uint32_t lastOledRenderTime = 0;
bool sdWritingIndicator = false;

// Calibration Screen State Variables
uint8_t calMode = 0; // 0 = Adjust Station Elevation (m), 1 = Adjust QNH (hPa)
bool calSavedMessage = false;
uint32_t calSavedTime = 0;
String serialCmdBuffer = "";
bool internetSyncActive = false;

// ==============================================================================
// SMD 0603 High-Intensity Strobe Engine (D2 / GPIO 2)
// Specifically calibrated pulse durations (35ms - 75ms) for 0603 LED optical persistence
// ==============================================================================
enum StrobeMode {
  STROBE_AVIATION_DOUBLE = 0, // FAA Commercial Jet Wingtip Double Pulse
  STROBE_EXECUTIVE_TRIPLE = 1, // Executive High-Visibility Triple Flash
  STROBE_AIRPORT_BEACON   = 2, // Aerodrome Rotating Beacon Simulation
  STROBE_TACTICAL_QUAD    = 3, // Military / Interceptor Quad Burst
  STROBE_RAPID_10HZ       = 4, // 10Hz High-Visibility Emergency Hazard
  STROBE_HEARTBEAT        = 5, // Biometric Avionics Cadence
  STROBE_STEALTH_BURST    = 6, // Micro-Dissipative Recon Burst
  STROBE_ALWAYS_ON        = 7, // Continuous Inspection Torch
  STROBE_OFF              = 8  // Strobe Inhibit / OFF
};

#define TOTAL_STROBE_MODES 9

const char* strobeNames[TOTAL_STROBE_MODES] = {
  "Airliner 2x",
  "Exec Triple",
  "Aero Beacon",
  "Tactical 4x",
  "Rapid 10Hz",
  "Heartbeat",
  "Stealth",
  "Solid Torch",
  "Disabled"
};

StrobeMode currentStrobeMode = STROBE_AIRPORT_BEACON;
uint32_t strobeTimer = 0;
uint8_t strobePhase = 0;
bool strobeLedState = false;

// ==============================================================================
// Tri-Color Dedicated SMD LED Engine (GPIO 2 White, GPIO 12 Green, GPIO 14 Orange)
// - White SMD LED  (GPIO 2):  Aero Beacon (Active continuously on device power-up)
// - Green SMD LED  (GPIO 12): Exec Triple (Active when BMP280 sensor is detected)
// - Orange SMD LED (GPIO 14): Stealth     (Active continuously on device power-up)
// ==============================================================================
uint32_t smdWhiteTimer  = 0;
uint8_t  smdWhitePhase  = 0;
bool     smdWhiteState  = false;

uint32_t smdGreenTimer  = 0;
uint8_t  smdGreenPhase  = 0;
bool     smdGreenState  = false;

uint32_t smdOrangeTimer = 0;
uint8_t  smdOrangePhase = 0;
bool     smdOrangeState = false;

// ==============================================================================
// UI Navigation & Menu State Machine (Soft Moving Animations & Transitions)
// ==============================================================================
enum AppScreen {
  SCREEN_LIVE_TELEMETRY   = 0,
  SCREEN_MAIN_MENU        = 1,
  SCREEN_GPS_NAV          = 2,
  SCREEN_VIEW_SD_LOGS     = 3,
  SCREEN_ALTITUDE_CAL     = 4,
  SCREEN_STROBE_MENU      = 5,
  SCREEN_SYSTEM_INFO      = 6
};

AppScreen currentScreen = SCREEN_LIVE_TELEMETRY;

// Main Menu Navigation
int menuCursor = 0;
int menuScrollOffset = 0;
const int TOTAL_MENU_ITEMS = 6;
const char* menuItems[TOTAL_MENU_ITEMS] = {
  "Live Telemetry",
  "GPS Navigation",
  "SD Station Logs",
  "Altimeter Cal",
  "Aero Strobe",
  "System Info"
};

// Smooth Animation Interpolation Coordinates
float animMenuCursorY = 12.0f;
float animScrollThumbY = 12.0f;
float animStrobeCursorY = 12.0f;
float animStrobeThumbY = 12.0f;

int strobeMenuCursor = 0;
int strobeScrollOffset = 0;

// SD Log Browser State
int32_t logBrowserIndex = 1;
int32_t logTotalRecords = 0;
String logCachedLine = "";

// ==============================================================================
// Button Debounce & Event State Machine
// ==============================================================================
struct ButtonState {
  uint8_t pin;
  bool isPressed;
  bool wasPressed;
  bool wasReleased;
  uint32_t lastDebounceTime;
  uint8_t lastReading;
  uint8_t stableState;
};

ButtonState btnUp     = { BUTTON_PIN_UP,     false, false, false, 0, HIGH, HIGH };
ButtonState btnDown   = { BUTTON_PIN_DOWN,   false, false, false, 0, HIGH, HIGH };
ButtonState btnCenter = { BUTTON_PIN_CENTER, false, false, false, 0, HIGH, HIGH };
ButtonState btnLeft   = { BUTTON_PIN_LEFT,   false, false, false, 0, HIGH, HIGH };
ButtonState btnRight  = { BUTTON_PIN_RIGHT,  false, false, false, 0, HIGH, HIGH };

#define DEBOUNCE_DELAY_MS 35

void updateSingleButton(ButtonState& b) {
  uint8_t reading = digitalRead(b.pin);
  b.wasPressed = false;
  b.wasReleased = false;

  if (reading != b.lastReading) {
    b.lastDebounceTime = millis();
  }
  b.lastReading = reading;

  if ((millis() - b.lastDebounceTime) > DEBOUNCE_DELAY_MS) {
    if (reading != b.stableState) {
      b.stableState = reading;
      if (b.stableState == LOW) {
        b.isPressed = true;
        b.wasPressed = true;
      } else {
        b.isPressed = false;
        b.wasReleased = true;
      }
    }
  }
}

// ==============================================================================
// Function Forward Declarations
// ==============================================================================
void showAestheticSplashScreen();
void scanI2CBus();
uint8_t readSensorChipId(uint8_t addr);
bool probeAndInitSensor();
void initSensors();
void initDisplay();
void initSDCard();
void initGPS();
void updateGPSData();
void initButtons();
void updateButtons();
void initSmdLeds();
void updateTriColorSmdLeds();
void updateStrobe();
void sampleSensors();
void updateWeatherTendency(float press);
void logToSD();
void loadCalibrationFromFlash();
void saveCalibrationToFlash();
void drawStatusBar();
void renderScreen();
void renderLiveTelemetry();
void renderMainMenu();
void renderGPSNav();
void renderViewSDLogs();
void renderAltitudeCal();
void renderStrobeMenu();
void renderSystemInfo();
void transitionToScreen(AppScreen newScreen);
void readSDRecordByIndex(int32_t targetIndex);
int32_t countSDRecords();
void processSerialCommands();
void handleIncomingCommand(const String& cmd);

// ==============================================================================
// Setup & Loop
// ==============================================================================

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n\n========================================");
  Serial.println("    AeroSense Precision Weather Station ");
  Serial.println("  ESP32 + BMP280 + 1.3\" OLED + SD Card  ");
  Serial.println("========================================");

  // Initialize Tri-Color SMD LEDs (GPIO 2 White, GPIO 12 Green, GPIO 14 Orange)
  initSmdLeds();

  // Trigger initial power-up flash on White (Aero Beacon) & Orange (Stealth) SMD LEDs
  updateStrobe();

  // Initialize Buttons
  initButtons();

  // Initialize Fast 400kHz I2C Bus (SDA: GPIO 21, SCL: GPIO 22)
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  Wire.setClock(400000);
  delay(50);

  // Load Saved QNH & Elevation Calibration from NVS Flash
  loadCalibrationFromFlash();

  // Initialize Display First
  initDisplay();

  // Show Aesthetic Splash Screen
  showAestheticSplashScreen();

  // Run Hardware I2C Scan
  scanI2CBus();

  // Initialize BMP280 with High-Precision Weather Configuration
  probeAndInitSensor();

  // Initialize SD Card
  initSDCard();

  // Initialize GPS NEO-6M (Fast, Non-blocking Hardware UART)
  initGPS();

  // Initial Sensor Reading
  sampleSensors();

  // Align strobe menu cursor with default mode
  strobeMenuCursor = (int)currentStrobeMode;

  // Render initial screen immediately to eliminate blank screen after splash
  renderScreen();

  Serial.println("AeroSense System Ready. Logging active.");
}

void loop() {
  uint32_t now = millis();

  // Non-blocking Airplane Strobe LED Engine
  updateStrobe();

  // Read and process GPS NEO-6M NMEA stream continuously (budget capped at 128 bytes/cycle to prevent starvation)
  int bytesRead = 0;
  while (SerialGPS.available() > 0 && bytesRead++ < 128) {
    char c = (char)SerialGPS.read();
    currentGps.totalBytesReceived++;
    currentGps.lastByteTime = now;

    if (gps.encode(c)) {
      currentGps.sentencesParsed++;
      updateGPSData();
    }
  }

  // Real-Time GPS Physical Connection & Disconnection Detection
  // Valid connection requires genuine NMEA sentences actively passing checksums (mirroring BMP280 chip ID verification)
  static uint32_t lastPassedChecksumCount = 0;
  static uint32_t lastValidSentenceTime = 0;

  if (gps.passedChecksum() > lastPassedChecksumCount) {
    lastPassedChecksumCount = gps.passedChecksum();
    lastValidSentenceTime = now;
    if (!currentGps.detected) {
      currentGps.detected = true;
      Serial.printf(">>> [GPS DETECTED] Valid NMEA data streaming on RX GPIO %d at %u baud! <<<\n",
                    currentGps.activeRxPin, currentGps.detectedBaud);
    }
  }

  // If no valid NMEA sentence has passed checksum in the last 3500ms -> stream disconnected or module unplugged
  if (lastValidSentenceTime == 0 || (now - lastValidSentenceTime >= 3500)) {
    if (currentGps.detected) {
      Serial.println(">>> [GPS DISCONNECTED] Data stream stopped. Module unplugged or no signal! <<<");
    }
    currentGps.detected = false;
    currentGps.fixValid = false;
    currentGps.latitude = 0.0;
    currentGps.longitude = 0.0;
    currentGps.speedKmh = 0.0f;
    currentGps.gpsAltitude = 0.0f;
    currentGps.satellites = 0;
  }

  // Non-blocking Intelligent Baud Search on RX GPIO 34 (GPIO 14 is dedicated to Orange SMD LED)
  // Operates ONLY when GPS is NOT detected. Gives 9600 baud on GPIO 34 top priority!
  static uint32_t lastGpsSearchSwitchTime = 0;
  static uint8_t gpsSearchStep = 0; // 0: GPIO34@9600, 1: GPIO34@38400, 2: GPIO34@115200

  if (!currentGps.detected && (now - lastGpsSearchSwitchTime >= 8000)) {
    lastGpsSearchSwitchTime = now;
    gpsSearchStep = (gpsSearchStep + 1) % 3;

    uint8_t targetRx = GPS_RX_PIN;  // Strictly GPIO 34
    int8_t targetTx  = -1;          // Receive-only so GPIO 14 stays dedicated to Orange SMD LED
    uint32_t targetBaud = 9600;

    switch (gpsSearchStep) {
      case 0: // Primary: GPIO 34 @ 9600
        targetBaud = 9600; break;
      case 1: // Alternate Baud: GPIO 34 @ 38400
        targetBaud = 38400; break;
      case 2: // Alternate Baud: GPIO 34 @ 115200
        targetBaud = 115200; break;
    }

    currentGps.activeRxPin = targetRx;
    currentGps.activeTxPin = targetTx;
    currentGps.detectedBaud = targetBaud;

    SerialGPS.flush();
    SerialGPS.end();
    delay(10);
    SerialGPS.begin(currentGps.detectedBaud, SERIAL_8N1, targetRx, targetTx);
    Serial.printf("[GPS Search] Listening on RX GPIO %d at %u baud...\n",
                  currentGps.activeRxPin, currentGps.detectedBaud);
  }

  // Read and Debounce Button Inputs
  updateButtons();

  // Non-blocking Web Serial & USB Internet Calibration Command Processing
  processSerialCommands();

  // Periodic Auto-Reconnect if BMP280 Sensor is Disconnected
  if (!currentData.sensorOk && (now - lastSensorRetryTime >= 2000)) {
    lastSensorRetryTime = now;
    if (probeAndInitSensor()) {
      sampleSensors();
    }
  }

  // Periodic Sensor Sampling (every 1 second)
  if (now - lastSampleTime >= SENSOR_SAMPLE_INTERVAL_MS) {
    lastSampleTime = now;
    sampleSensors();
  }

  // Periodic Pressure Trend Calculation (every 10 seconds)
  if (currentData.sensorOk && !isnan(currentData.pressure)) {
    if (now - lastPressureTrendTime >= 10000 || pressureTrendCount == 0) {
      lastPressureTrendTime = now;
      updateWeatherTendency(currentData.pressure);
    }
  }

  // Emit Real-Time Telemetry over Serial (every 1000ms) with GPS Coordinates
  if (now - lastSerialStreamTime >= 1000) {
    lastSerialStreamTime = now;
    if (currentData.sensorOk && !isnan(currentData.temperature)) {
      Serial.printf("$AERO,%u,%.2f,%.2f,%.2f,%.2f,%.6f,%.6f,%.1f,%u,%d\n",
                    now / 1000,
                    currentData.temperature,
                    currentData.pressure,
                    currentData.altitude,
                    currentData.seaLevelPressure,
                    currentGps.latitude,
                    currentGps.longitude,
                    currentGps.speedKmh,
                    currentGps.satellites,
                    currentGps.fixValid ? 1 : 0);
    }
  }

  // Periodic MicroSD Data Logging (every 5 seconds)
  if (now - lastLogTime >= SD_LOG_INTERVAL_MS) {
    lastLogTime = now;
    logToSD();
  }

  // OLED Screen Refresh (Non-blocking 25 FPS Cadence: 40ms)
  if (now - lastOledRenderTime >= 40) {
    lastOledRenderTime = now;
    renderScreen();
  }
}

// ==============================================================================
// Persistent Flash Storage (NVS Calibration)
// ==============================================================================

void loadCalibrationFromFlash() {
  preferences.begin("aerosense", true); // read-only mode
  currentData.seaLevelPressure = preferences.getFloat("qnh", STANDARD_SEA_LEVEL_HPA);
  currentData.stationElevation = preferences.getFloat("elev", DEFAULT_STATION_ELEVATION_M);
  double savedLat = preferences.getDouble("lat", 0.0);
  double savedLon = preferences.getDouble("lon", 0.0);
  preferences.end();

  // Keep live navigation coordinates strictly 0.0 until valid live satellite fix!
  currentGps.latitude = 0.0;
  currentGps.longitude = 0.0;
  currentGps.fixValid = false;

  if (currentData.seaLevelPressure < 850.0f || currentData.seaLevelPressure > 1100.0f) {
    currentData.seaLevelPressure = STANDARD_SEA_LEVEL_HPA;
  }
  if (currentData.stationElevation < -500.0f || currentData.stationElevation > 9000.0f) {
    currentData.stationElevation = DEFAULT_STATION_ELEVATION_M;
  }

  Serial.printf("[NVS] Loaded Calibration -> QNH: %.2f hPa, Station Elevation: %.1f m (Last Saved GPS: %.5f, %.5f)\n",
                currentData.seaLevelPressure, currentData.stationElevation, savedLat, savedLon);
}

void saveCalibrationToFlash() {
  preferences.begin("aerosense", false); // read-write mode
  preferences.putFloat("qnh", currentData.seaLevelPressure);
  preferences.putFloat("elev", currentData.stationElevation);
  if (currentGps.fixValid) {
    preferences.putDouble("lat", currentGps.latitude);
    preferences.putDouble("lon", currentGps.longitude);
  }
  preferences.end();

  Serial.printf("[NVS] Saved Calibration -> QNH: %.2f hPa, Station Elevation: %.1f m\n",
                currentData.seaLevelPressure, currentData.stationElevation);
}

// ==============================================================================
// Hardware I2C Scanning & Robust Sensor Probing
// ==============================================================================

void scanI2CBus() {
  Serial.println("\nScanning I2C bus (SDA: GPIO 21, SCL: GPIO 22)...");
  uint8_t count = 0;
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    uint8_t error = Wire.endTransmission();
    if (error == 0) {
      Serial.printf(" - Found I2C device at 0x%02X", addr);
      if (addr == 0x3C || addr == 0x3D) Serial.print(" (OLED Display)");
      else if (addr == 0x76 || addr == 0x77) Serial.print(" (BMP280/BME280 Sensor)");
      Serial.println();
      count++;
    }
  }
  if (count == 0) {
    Serial.println("No I2C devices found! Check wiring, pull-ups, and power.");
  }
  Serial.println("I2C scan complete.\n");
}

uint8_t readSensorChipId(uint8_t addr) {
  Wire.beginTransmission(addr);
  Wire.write(0xD0);
  if (Wire.endTransmission(false) != 0) {
    return 0x00;
  }
  if (Wire.requestFrom((int)addr, 1) == 1) {
    return Wire.read();
  }
  return 0x00;
}

bool probeAndInitSensor() {
  uint8_t addresses[] = { BMP280_ADDR_PRIMARY, BMP280_ADDR_SECONDARY };
  uint8_t tryIds[] = { 0x58, 0x56, 0x57, 0x60 };

  for (uint8_t a = 0; a < 2; a++) {
    uint8_t addr = addresses[a];
    uint8_t chipId = readSensorChipId(addr);

    if (chipId == 0x00 || chipId == 0xFF) continue;

    for (uint8_t i = 0; i < sizeof(tryIds); i++) {
      if (bmp.begin(addr, tryIds[i])) {
        // High-Precision Meteorological & Altimeter Configuration (Bosch Sensortec Specification)
        bmp.setSampling(
          Adafruit_BMP280::MODE_NORMAL,     /* Operating Mode: Continuous normal sampling */
          Adafruit_BMP280::SAMPLING_X2,     /* Temperature oversampling: x2 (17-bit resolution) */
          Adafruit_BMP280::SAMPLING_X16,    /* Pressure oversampling: x16 (20-bit ultra-high resolution) */
          Adafruit_BMP280::FILTER_X16,      /* IIR Filter coefficient: 16 (removes wind gusts & noise) */
          Adafruit_BMP280::STANDBY_MS_63    /* Standby time: 62.5 ms */
        );

        float testTemp = bmp.readTemperature();
        float testPress = bmp.readPressure() / 100.0f;

        if (!isnan(testTemp) && !isnan(testPress) && testPress >= 300.0f && testPress <= 1250.0f) {
          currentData.sensorOk = true;
          currentData.i2cAddress = addr;
          currentData.detectedChipId = tryIds[i];

          // Immediately trigger Green SMD LED (GPIO 12) Exec Triple flash upon BMP280 detection!
          smdGreenPhase = 0;
          smdGreenTimer = millis();
          updateTriColorSmdLeds();

          Serial.printf(">>> SUCCESS: Real GY-BMP280 Sensor Connected at 0x%02X (Chip ID 0x%02X) <<<\n", addr, tryIds[i]);
          Serial.printf("Real Readings -> Temp: %.2f C, Pressure: %.2f hPa\n", testTemp, testPress);
          Serial.printf(">>> [SMD LEDs] GREEN (GPIO %d) Exec Triple ACTIVE | WHITE (GPIO %d) Aero Beacon | ORANGE (GPIO %d) Stealth <<<\n",
                        SMD_LED_GREEN_PIN, SMD_LED_WHITE_PIN, SMD_LED_ORANGE_PIN);
          return true;
        }
      }
    }
  }

  currentData.sensorOk = false;
  return false;
}

void initSensors() {
  probeAndInitSensor();
}

// ==============================================================================
// Ultra-Aesthetic AeroSense Splash Screen
// ==============================================================================
void showAestheticSplashScreen() {
  display.setTextWrap(false);

  // Laser Horizon Beam Expanding from Center
  for (int w = 0; w <= 54; w += 3) {
    updateStrobe();
    display.clearDisplay();
    display.drawLine(64 - w, 31, 64 + w, 31, 1);
    display.display();
    delay(8);
  }

  // Horizon Frame Separation
  for (int h = 0; h <= 15; h += 3) {
    updateStrobe();
    display.clearDisplay();
    display.drawLine(10, 31 - h, 118, 31 - h, 1);
    display.drawLine(10, 31 + h, 118, 31 + h, 1);
    display.display();
    delay(10);
  }

  // Display "AeroSense" in Bold Aesthetic Aviation Typography
  display.clearDisplay();
  display.drawLine(10, 16, 118, 16, 1);
  display.drawLine(10, 47, 118, 47, 1);
  display.drawLine(10, 16, 10, 22, 1);
  display.drawLine(10, 41, 10, 47, 1);
  display.drawLine(118, 16, 118, 22, 1);
  display.drawLine(118, 41, 118, 47, 1);
  display.drawLine(0, 31, 5, 31, 1);
  display.drawLine(122, 31, 127, 31, 1);
  display.fillRect(63, 15, 3, 3, 1);
  display.fillRect(63, 46, 3, 3, 1);

  display.setTextColor(1, 0);
  display.setTextSize(2);
  display.setCursor(11, 24);
  display.print("AeroSense");
  display.display();
  for (int t = 0; t < 100; t++) {
    updateStrobe();
    delay(10);
  }

  // Horizontal Shutter Transition
  for (int step = 0; step <= 32; step += 4) {
    updateStrobe();
    display.fillRect(0, 0, 128, step, 0);
    display.fillRect(0, 64 - step, 128, step, 0);
    display.display();
    delay(8);
  }
  display.clearDisplay();
  display.display();
}

void initDisplay() {
  Serial.print("Initializing OLED Display (128x64)... ");
#if USE_SH1106
  if (!display.begin(OLED_I2C_ADDRESS, true)) {
    Serial.println("SH1106 initialization failed!");
  } else {
    Serial.println("SH1106 OLED Initialized.");
  }
#else
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_I2C_ADDRESS)) {
    Serial.println("SSD1306 initialization failed!");
  } else {
    Serial.println("SSD1306 OLED Initialized.");
  }
#endif
  display.clearDisplay();
  display.display();
}

void initSDCard() {
  Serial.printf("Initializing SPI MicroSD Card (CS: GPIO %d)... ", SD_CS);
  sdSPI.begin(SPI_SCK_PIN, SPI_MISO_PIN, SPI_MOSI_PIN, SD_CS);

  if (!SD.begin(SD_CS, sdSPI, 20000000)) {
    Serial.println("SD Card Mount Failed! System will operate in live streaming mode.");
    sdAvailable = false;
  } else {
    sdAvailable = true;
    uint8_t cardType = SD.cardType();
    Serial.printf("SD Card Mounted Successfully (Type: %d).\n", cardType);

    if (!SD.exists(CSV_FILE_PATH)) {
      File file = SD.open(CSV_FILE_PATH, FILE_WRITE);
      if (file) {
        file.println("Record,Time_s,Temperature_C,Pressure_hPa,Altitude_m,QNH_hPa,Latitude,Longitude,Speed_kmh,Satellites,Fix");
        file.close();
        Serial.println("Created fresh aerosense.csv log file on SD card with GPS fields.");
      }
    } else {
      totalRecordsLogged = countSDRecords();
      Serial.printf("Found existing aerosense.csv with %u historical records.\n", totalRecordsLogged);
    }
  }
}

void initButtons() {
  pinMode(BUTTON_PIN_UP,     INPUT_PULLUP);
  pinMode(BUTTON_PIN_DOWN,   INPUT_PULLUP);
  pinMode(BUTTON_PIN_CENTER, INPUT_PULLUP);
  pinMode(BUTTON_PIN_LEFT,   INPUT_PULLUP);
  pinMode(BUTTON_PIN_RIGHT,  INPUT_PULLUP);
}

void updateButtons() {
  updateSingleButton(btnUp);
  updateSingleButton(btnDown);
  updateSingleButton(btnCenter);
  updateSingleButton(btnLeft);
  updateSingleButton(btnRight);

  // Screen-Specific Intuitive Navigation Logic
  switch (currentScreen) {
    case SCREEN_LIVE_TELEMETRY:
      if (btnRight.wasPressed || btnCenter.wasPressed || btnDown.wasPressed) {
        transitionToScreen(SCREEN_MAIN_MENU);
      }
      break;

    case SCREEN_MAIN_MENU:
      if (btnUp.wasPressed) {
        menuCursor--;
        if (menuCursor < 0) menuCursor = TOTAL_MENU_ITEMS - 1;
      }
      if (btnDown.wasPressed) {
        menuCursor++;
        if (menuCursor >= TOTAL_MENU_ITEMS) menuCursor = 0;
      }
      // Both Center and Right act as Select / Enter
      if (btnRight.wasPressed || btnCenter.wasPressed) {
        switch (menuCursor) {
          case 0: transitionToScreen(SCREEN_LIVE_TELEMETRY); break;
          case 1: transitionToScreen(SCREEN_GPS_NAV);        break;
          case 2: 
            transitionToScreen(SCREEN_VIEW_SD_LOGS); 
            logTotalRecords = countSDRecords();
            logBrowserIndex = (logTotalRecords > 0) ? logTotalRecords : 0;
            readSDRecordByIndex(logBrowserIndex);
            break;
          case 3: transitionToScreen(SCREEN_ALTITUDE_CAL);  break;
          case 4: 
            transitionToScreen(SCREEN_STROBE_MENU);   
            strobeMenuCursor = (int)currentStrobeMode;
            break;
          case 5: transitionToScreen(SCREEN_SYSTEM_INFO);   break;
        }
      }
      if (btnLeft.wasPressed) {
        transitionToScreen(SCREEN_LIVE_TELEMETRY);
      }
      break;

    case SCREEN_GPS_NAV:
      if (btnLeft.wasPressed || btnCenter.wasPressed || btnRight.wasPressed) {
        transitionToScreen(SCREEN_MAIN_MENU);
      }
      break;

    case SCREEN_ALTITUDE_CAL:
      if (btnCenter.wasPressed) {
        calMode = 1 - calMode;
      }

      if (btnUp.wasPressed) {
        if (calMode == 0) {
          currentData.stationElevation += 1.0f;
          if (currentData.sensorOk && !isnan(currentData.filteredPressure)) {
            float tempK = currentData.temperature + 273.15f;
            currentData.seaLevelPressure = currentData.filteredPressure * 
              powf(1.0f + (HYPSOMETRIC_LAPSE_RATE * currentData.stationElevation) / tempK, 1.0f / HYPSOMETRIC_EXPONENT);
          }
        } else {
          currentData.seaLevelPressure += 0.1f;
          if (currentData.seaLevelPressure > 1100.0f) currentData.seaLevelPressure = 1100.0f;
          if (currentData.sensorOk && !isnan(currentData.filteredPressure)) {
            float tempK = currentData.temperature + 273.15f;
            currentData.stationElevation = ((powf(currentData.seaLevelPressure / currentData.filteredPressure, HYPSOMETRIC_EXPONENT) - 1.0f) * tempK) / HYPSOMETRIC_LAPSE_RATE;
          }
        }
      }

      if (btnDown.wasPressed) {
        if (calMode == 0) {
          currentData.stationElevation -= 1.0f;
          if (currentData.sensorOk && !isnan(currentData.filteredPressure)) {
            float tempK = currentData.temperature + 273.15f;
            currentData.seaLevelPressure = currentData.filteredPressure * 
              powf(1.0f + (HYPSOMETRIC_LAPSE_RATE * currentData.stationElevation) / tempK, 1.0f / HYPSOMETRIC_EXPONENT);
          }
        } else {
          currentData.seaLevelPressure -= 0.1f;
          if (currentData.seaLevelPressure < 850.0f) currentData.seaLevelPressure = 850.0f;
          if (currentData.sensorOk && !isnan(currentData.filteredPressure)) {
            float tempK = currentData.temperature + 273.15f;
            currentData.stationElevation = ((powf(currentData.seaLevelPressure / currentData.filteredPressure, HYPSOMETRIC_EXPONENT) - 1.0f) * tempK) / HYPSOMETRIC_LAPSE_RATE;
          }
        }
      }

      if (btnRight.wasPressed) {
        saveCalibrationToFlash();
        calSavedMessage = true;
        calSavedTime = millis();
      }

      if (btnLeft.wasPressed) {
        transitionToScreen(SCREEN_MAIN_MENU);
      }
      break;

    case SCREEN_STROBE_MENU:
      if (btnUp.wasPressed) {
        strobeMenuCursor--;
        if (strobeMenuCursor < 0) strobeMenuCursor = TOTAL_STROBE_MODES - 1;
        currentStrobeMode = (StrobeMode)strobeMenuCursor;
        strobePhase = 0;
        strobeTimer = millis();
      }
      if (btnDown.wasPressed) {
        strobeMenuCursor++;
        if (strobeMenuCursor >= TOTAL_STROBE_MODES) strobeMenuCursor = 0;
        currentStrobeMode = (StrobeMode)strobeMenuCursor;
        strobePhase = 0;
        strobeTimer = millis();
      }
      if (btnRight.wasPressed || btnCenter.wasPressed) {
        currentStrobeMode = (StrobeMode)strobeMenuCursor;
        strobePhase = 0;
        strobeTimer = millis();
      }
      if (btnLeft.wasPressed) {
        transitionToScreen(SCREEN_MAIN_MENU);
      }
      break;

    case SCREEN_VIEW_SD_LOGS:
      if (btnUp.wasPressed) {
        if (logBrowserIndex > 1) {
          logBrowserIndex--;
          readSDRecordByIndex(logBrowserIndex);
        }
      }
      if (btnDown.wasPressed) {
        if (logBrowserIndex < logTotalRecords) {
          logBrowserIndex++;
          readSDRecordByIndex(logBrowserIndex);
        }
      }
      if (btnLeft.wasPressed || btnCenter.wasPressed) {
        transitionToScreen(SCREEN_MAIN_MENU);
      }
      break;

    case SCREEN_SYSTEM_INFO:
      if (btnLeft.wasPressed || btnCenter.wasPressed || btnRight.wasPressed) {
        transitionToScreen(SCREEN_MAIN_MENU);
      }
      break;
  }
}

// ==============================================================================
// Tri-Color Dedicated SMD LED Engine (GPIO 2 White, GPIO 12 Green, GPIO 14 Orange)
// Precision pulses (35ms - 75ms) tuned specifically for SMD 0603/0805 optical brilliance.
// Runs continuously in background across ALL screens!
// ==============================================================================

void initSmdLeds() {
  pinMode(SMD_LED_WHITE_PIN, OUTPUT);
  pinMode(SMD_LED_GREEN_PIN, OUTPUT);
  pinMode(SMD_LED_ORANGE_PIN, OUTPUT);

  digitalWrite(SMD_LED_WHITE_PIN, LOW);
  digitalWrite(SMD_LED_GREEN_PIN, LOW);
  digitalWrite(SMD_LED_ORANGE_PIN, LOW);

  uint32_t now = millis();
  smdWhiteTimer  = now;
  smdGreenTimer  = now;
  smdOrangeTimer = now;
  strobeTimer    = now;

  Serial.printf("[SMD LEDs] Initialized -> WHITE (GPIO %d: Aero Beacon), GREEN (GPIO %d: Exec Triple on BMP280), ORANGE (GPIO %d: Stealth)\n",
                SMD_LED_WHITE_PIN, SMD_LED_GREEN_PIN, SMD_LED_ORANGE_PIN);
}

void updateTriColorSmdLeds() {
  uint32_t now = millis();

  // ----------------------------------------------------------------------------
  // 1. ORANGE SMD LED (GPIO 14) -> Flashes "Stealth" when device is powered up
  //    Cadence: 35ms ON, 1965ms OFF (Crisp 35ms pulse for SMD LED visibility)
  // ----------------------------------------------------------------------------
  if (smdOrangePhase == 0) {
    smdOrangeState = true;
    if (now - smdOrangeTimer >= 35) {
      smdOrangeState = false;
      smdOrangePhase = 1;
      smdOrangeTimer = now;
    }
  } else {
    smdOrangeState = false;
    if (now - smdOrangeTimer >= 1965) {
      smdOrangePhase = 0;
      smdOrangeTimer = now;
    }
  }
  digitalWrite(SMD_LED_ORANGE_PIN, smdOrangeState ? HIGH : LOW);

  // ----------------------------------------------------------------------------
  // 2. GREEN SMD LED (GPIO 12) -> Flashes "Exec Triple" ONLY when BMP280 is detected
  //    Cadence: 40ms ON, 60ms OFF, 40ms ON, 60ms OFF, 40ms ON, 1200ms OFF
  // ----------------------------------------------------------------------------
  if (currentData.sensorOk) {
    if (smdGreenPhase == 0 || smdGreenPhase == 2 || smdGreenPhase == 4) {
      smdGreenState = true;
      if (now - smdGreenTimer >= 40) {
        smdGreenState = false;
        smdGreenPhase++;
        smdGreenTimer = now;
      }
    } else if (smdGreenPhase == 1 || smdGreenPhase == 3) {
      smdGreenState = false;
      if (now - smdGreenTimer >= 60) {
        smdGreenPhase++;
        smdGreenTimer = now;
      }
    } else {
      smdGreenState = false;
      if (now - smdGreenTimer >= 1200) {
        smdGreenPhase = 0;
        smdGreenTimer = now;
      }
    }
  } else {
    smdGreenState = false;
    smdGreenPhase = 0;
    smdGreenTimer = now;
  }
  digitalWrite(SMD_LED_GREEN_PIN, smdGreenState ? HIGH : LOW);
}

void updateStrobe() {
  // Update Orange (GPIO 14: Stealth) and Green (GPIO 12: Exec Triple on BMP280 detect)
  updateTriColorSmdLeds();

  // Update White SMD LED (GPIO 2): Defaults to Aero Beacon (STROBE_AIRPORT_BEACON) on power-up!
  uint32_t now = millis();

  switch (currentStrobeMode) {
    case STROBE_AVIATION_DOUBLE: // 45ms ON, 80ms OFF, 45ms ON, 1000ms OFF
      if (strobePhase == 0) {
        strobeLedState = true;
        if (now - strobeTimer >= 45) {
          strobeLedState = false;
          strobePhase = 1;
          strobeTimer = now;
        }
      } else if (strobePhase == 1) {
        strobeLedState = false;
        if (now - strobeTimer >= 80) {
          strobeLedState = true;
          strobePhase = 2;
          strobeTimer = now;
        }
      } else if (strobePhase == 2) {
        strobeLedState = true;
        if (now - strobeTimer >= 45) {
          strobeLedState = false;
          strobePhase = 3;
          strobeTimer = now;
        }
      } else {
        strobeLedState = false;
        if (now - strobeTimer >= 1000) {
          strobePhase = 0;
          strobeTimer = now;
        }
      }
      break;

    case STROBE_EXECUTIVE_TRIPLE:
      if (strobePhase == 0 || strobePhase == 2 || strobePhase == 4) {
        strobeLedState = true;
        if (now - strobeTimer >= 40) {
          strobeLedState = false;
          strobePhase++;
          strobeTimer = now;
        }
      } else if (strobePhase == 1 || strobePhase == 3) {
        strobeLedState = false;
        if (now - strobeTimer >= 60) {
          strobePhase++;
          strobeTimer = now;
        }
      } else {
        strobeLedState = false;
        if (now - strobeTimer >= 1200) {
          strobePhase = 0;
          strobeTimer = now;
        }
      }
      break;

    case STROBE_AIRPORT_BEACON:
      if (strobePhase == 0) {
        strobeLedState = true;
        if (now - strobeTimer >= 75) {
          strobeLedState = false;
          strobePhase = 1;
          strobeTimer = now;
        }
      } else {
        strobeLedState = false;
        if (now - strobeTimer >= 925) {
          strobePhase = 0;
          strobeTimer = now;
        }
      }
      break;

    case STROBE_TACTICAL_QUAD:
      if (strobePhase == 0 || strobePhase == 2 || strobePhase == 4 || strobePhase == 6) {
        strobeLedState = true;
        if (now - strobeTimer >= 30) {
          strobeLedState = false;
          strobePhase++;
          strobeTimer = now;
        }
      } else if (strobePhase == 1 || strobePhase == 3 || strobePhase == 5) {
        strobeLedState = false;
        if (now - strobeTimer >= 50) {
          strobePhase++;
          strobeTimer = now;
        }
      } else {
        strobeLedState = false;
        if (now - strobeTimer >= 800) {
          strobePhase = 0;
          strobeTimer = now;
        }
      }
      break;

    case STROBE_RAPID_10HZ:
      if (strobePhase == 0) {
        strobeLedState = true;
        if (now - strobeTimer >= 50) {
          strobeLedState = false;
          strobePhase = 1;
          strobeTimer = now;
        }
      } else {
        strobeLedState = false;
        if (now - strobeTimer >= 50) {
          strobePhase = 0;
          strobeTimer = now;
        }
      }
      break;

    case STROBE_HEARTBEAT:
      if (strobePhase == 0) {
        strobeLedState = true;
        if (now - strobeTimer >= 60) {
          strobeLedState = false;
          strobePhase = 1;
          strobeTimer = now;
        }
      } else if (strobePhase == 1) {
        strobeLedState = false;
        if (now - strobeTimer >= 120) {
          strobeLedState = true;
          strobePhase = 2;
          strobeTimer = now;
        }
      } else if (strobePhase == 2) {
        strobeLedState = true;
        if (now - strobeTimer >= 40) {
          strobeLedState = false;
          strobePhase = 3;
          strobeTimer = now;
        }
      } else {
        strobeLedState = false;
        if (now - strobeTimer >= 780) {
          strobePhase = 0;
          strobeTimer = now;
        }
      }
      break;

    case STROBE_STEALTH_BURST:
      if (strobePhase == 0) {
        strobeLedState = true;
        if (now - strobeTimer >= 25) {
          strobeLedState = false;
          strobePhase = 1;
          strobeTimer = now;
        }
      } else {
        strobeLedState = false;
        if (now - strobeTimer >= 2000) {
          strobePhase = 0;
          strobeTimer = now;
        }
      }
      break;

    case STROBE_ALWAYS_ON:
      strobeLedState = true;
      break;

    case STROBE_OFF:
    default:
      strobeLedState = false;
      break;
  }

  digitalWrite(STROBE_LED_PIN, strobeLedState ? HIGH : LOW);
}

// ==============================================================================
// Sensor Sampling & Temperature-Compensated Hypsometric Formula
// Strictly authentic physical sensor measurements - No random values!
// ==============================================================================

void sampleSensors() {
  if (currentData.sensorOk) {
    float temp = bmp.readTemperature();
    float press = bmp.readPressure() / 100.0f;

    if (!isnan(temp) && !isnan(press) && press >= 300.0f && press <= 1250.0f && temp >= -40.0f && temp <= 85.0f) {
      currentData.temperature = temp;
      currentData.rawPressure = press;

      // Digital Low-Pass Exponential Moving Average filter (alpha = 0.15)
      if (isnan(currentData.filteredPressure)) {
        currentData.filteredPressure = press;
      } else {
        currentData.filteredPressure += (press - currentData.filteredPressure) * 0.15f;
      }
      currentData.pressure = currentData.filteredPressure;

      // Exact Temperature-Compensated Hypsometric Formula:
      float tempK = temp + 273.15f;
      float compAltitude = ((powf(currentData.seaLevelPressure / currentData.filteredPressure, HYPSOMETRIC_EXPONENT) - 1.0f) * tempK) / HYPSOMETRIC_LAPSE_RATE;

      if (isnan(currentData.altitude)) {
        currentData.altitude = compAltitude;
      } else {
        currentData.altitude += (compAltitude - currentData.altitude) * 0.20f;
      }
      return;
    } else {
      currentData.sensorOk = false;
    }
  }

  // Sensor Offline
  currentData.temperature = NAN;
  currentData.rawPressure = NAN;
  currentData.filteredPressure = NAN;
  currentData.pressure = NAN;
  currentData.altitude = NAN;
}

void updateWeatherTendency(float press) {
  if (isnan(press)) return;

  pressureTrendBuf[pressureTrendIdx] = press;
  pressureTrendIdx = (pressureTrendIdx + 1) % PRESSURE_TREND_BUF_SIZE;
  if (pressureTrendCount < PRESSURE_TREND_BUF_SIZE) {
    pressureTrendCount++;
  }

  if (pressureTrendCount >= 2) {
    uint8_t oldestIdx = (pressureTrendCount < PRESSURE_TREND_BUF_SIZE) ? 0 : pressureTrendIdx;
    float deltaP = press - pressureTrendBuf[oldestIdx];
    float hours = (float)pressureTrendCount * (10.0f / 3600.0f);
    if (hours > 0.005f) {
      currentData.pressureTrend = deltaP / hours;
    }
  }

  // Classify Weather State for Aesthetic Display
  float p = currentData.pressure;
  float t = currentData.pressureTrend;

  if (t < -1.8f || p < 995.0f) {
    currentData.weatherCondition = "STORM FRONT";
  } else if (t < -0.6f || p < 1006.0f) {
    currentData.weatherCondition = "RAIN SHOWERS";
  } else if (p < 1012.0f || t < -0.2f) {
    currentData.weatherCondition = "OVERCAST / CLOUD";
  } else if (p >= 1012.0f && p < 1020.0f) {
    currentData.weatherCondition = "FAIR WEATHER";
  } else {
    currentData.weatherCondition = "CLEAR & SUNNY";
  }
}

// ==============================================================================
// MicroSD Card Logging & Log Viewer
// ==============================================================================

void logToSD() {
  if (!sdAvailable || !currentData.sensorOk || isnan(currentData.temperature)) return;

  sdWritingIndicator = true;
  File file = SD.open(CSV_FILE_PATH, FILE_APPEND);
  if (file) {
    totalRecordsLogged++;
    uint32_t secondsElapsed = millis() / 1000;
    file.printf("%u,%u,%.2f,%.2f,%.2f,%.2f,%.6f,%.6f,%.1f,%u,%d\n",
                totalRecordsLogged,
                secondsElapsed,
                currentData.temperature,
                currentData.pressure,
                currentData.altitude,
                currentData.seaLevelPressure,
                currentGps.latitude,
                currentGps.longitude,
                currentGps.speedKmh,
                currentGps.satellites,
                currentGps.fixValid ? 1 : 0);
    file.flush();
    file.close();
    logTotalRecords = totalRecordsLogged;
  }
  sdWritingIndicator = false;
}

int32_t countSDRecords() {
  if (!sdAvailable) return 0;
  File file = SD.open(CSV_FILE_PATH, FILE_READ);
  if (!file) return 0;

  int32_t lines = 0;
  while (file.available()) {
    String line = file.readStringUntil('\n');
    line.trim();
    if (line.length() > 0 && !line.startsWith("Record")) {
      lines++;
    }
  }
  file.close();
  return lines;
}

void readSDRecordByIndex(int32_t targetIndex) {
  if (!sdAvailable || targetIndex <= 0) {
    logCachedLine = "No Logs";
    return;
  }

  File file = SD.open(CSV_FILE_PATH, FILE_READ);
  if (!file) {
    logCachedLine = "Read Error";
    return;
  }

  int32_t currentLine = 0;
  while (file.available()) {
    String line = file.readStringUntil('\n');
    line.trim();
    if (line.length() > 0 && !line.startsWith("Record")) {
      currentLine++;
      if (currentLine == targetIndex) {
        logCachedLine = line;
        file.close();
        return;
      }
    }
  }
  file.close();
  logCachedLine = "EOF";
}

// ==============================================================================
// OLED Display Rendering Engine
// ==============================================================================

void drawStatusBar() {
  display.setTextSize(1);
  display.setTextColor(1, 0);

  // Station Identity
  display.setCursor(2, 0);
  display.print("AERO");

  // GPS Status Indicator (X: 30)
  display.setCursor(30, 0);
  if (currentGps.fixValid) {
    display.printf("[G:%u]", currentGps.satellites);
  } else if (currentGps.detected) {
    display.print("[G:ACQ]");
  } else {
    display.print("[NO-G]");
  }

  // Real-Time MicroSD Indicator
  if (sdAvailable) {
    if (sdWritingIndicator) {
      display.fillRect(66, 0, 24, 8, 1);
      display.setTextColor(0, 1);
      display.setCursor(68, 0);
      display.print("REC");
      display.setTextColor(1, 0);
    } else {
      display.setCursor(66, 0);
      display.print("[SD]");
    }
  } else {
    display.setCursor(64, 0);
    display.print("[NO-SD]");
  }

  // Real-Time Strobe Indicator
  if (currentStrobeMode != STROBE_OFF) {
    if (strobeLedState) {
      display.fillRect(96, 0, 31, 8, 1);
      display.setTextColor(0, 1);
      display.setCursor(98, 0);
      display.print("STR*");
      display.setTextColor(1, 0);
    } else {
      display.setCursor(96, 0);
      display.print("[STR]");
    }
  } else {
    display.setCursor(97, 0);
    display.print("[OFF]");
  }

  display.drawFastHLine(0, 9, 128, 1);
}

void renderScreen() {
  display.clearDisplay();
  display.setTextWrap(false);

  if (currentScreen == SCREEN_LIVE_TELEMETRY || currentScreen == SCREEN_MAIN_MENU) {
    drawStatusBar();
  }

  switch (currentScreen) {
    case SCREEN_LIVE_TELEMETRY:   renderLiveTelemetry();   break;
    case SCREEN_MAIN_MENU:        renderMainMenu();        break;
    case SCREEN_GPS_NAV:          renderGPSNav();          break;
    case SCREEN_VIEW_SD_LOGS:     renderViewSDLogs();      break;
    case SCREEN_ALTITUDE_CAL:     renderAltitudeCal();     break;
    case SCREEN_STROBE_MENU:      renderStrobeMenu();      break;
    case SCREEN_SYSTEM_INFO:      renderSystemInfo();      break;
  }

  display.display();
}

// ------------------------------------------------------------------------------
// Screen 1: Live Precision Telemetry Dashboard with Aesthetic Weather UI
// ------------------------------------------------------------------------------
void renderLiveTelemetry() {
  if (!currentData.sensorOk || isnan(currentData.temperature) || isnan(currentData.pressure)) {
    display.drawRoundRect(4, 13, 120, 48, 3, 1);
    display.fillRect(6, 15, 116, 11, 1);
    display.setTextColor(0, 1);
    display.setTextSize(1);
    display.setCursor(10, 17);
    display.print("! SENSOR OFFLINE !");
    display.setTextColor(1, 0);

    display.setCursor(10, 30);
    display.print("BMP280 Not Detected");
    display.setCursor(10, 40);
    display.print("SDA:Pin 21 SCL:Pin 22");
    display.setCursor(10, 50);
    display.print("Auto-Scanning Bus...");
    return;
  }

  // Row 1: Weather Icon pill frame (X: 2, Y: 11, W: 20, H: 18)
  display.drawRoundRect(2, 11, 20, 18, 2, 1);
  const unsigned char* iconToDraw = icon_sun;
  if (strcmp(currentData.weatherCondition, "STORM FRONT") == 0) {
    iconToDraw = icon_storm;
  } else if (strcmp(currentData.weatherCondition, "RAIN SHOWERS") == 0) {
    iconToDraw = icon_rain;
  } else if (strcmp(currentData.weatherCondition, "OVERCAST / CLOUD") == 0) {
    iconToDraw = icon_cloud;
  }
  display.drawBitmap(4, 12, iconToDraw, 16, 16, 1);

  // Weather Condition Headline
  display.setTextSize(1);
  display.setTextColor(1, 0);
  display.setCursor(25, 12);
  display.print(currentData.weatherCondition);

  // Barometric Tendency Arrow & Rate (Y: 21)
  display.setCursor(25, 21);
  if (currentData.pressureTrend < -1.0f)      display.print("v! Rapid Drop");
  else if (currentData.pressureTrend < -0.2f) display.printf("v %+.1f hPa/h", currentData.pressureTrend);
  else if (currentData.pressureTrend > 1.0f)  display.print("^^ Rapid Rise");
  else if (currentData.pressureTrend > 0.2f)  display.printf("^ %+.1f hPa/h", currentData.pressureTrend);
  else                                       display.print("- Baro Steady");

  // Horizon Rail Divider with Center Accent Diamond
  display.drawFastHLine(2, 31, 124, 1);
  display.fillRect(63, 30, 3, 3, 1);

  // Precision 2x2 Telemetry Grid (Y: 34-51)
  // Row 1: Altitude & QNH
  display.setCursor(3, 34);
  if (abs(currentData.altitude) < 1000.0f) {
    display.printf("ALT:%5.1fm", currentData.altitude);
  } else {
    display.printf("ALT:%5.0fm", currentData.altitude);
  }
  display.setCursor(68, 34);
  display.printf("QNH: %6.1f", currentData.seaLevelPressure);

  // Row 2: Baro & Temp
  display.setCursor(3, 44);
  display.printf("BAR: %6.1f", currentData.pressure);
  display.setCursor(68, 44);
  display.printf("TMP: %4.1fC", currentData.temperature);

  // Bottom Navigation Footer (Y: 54-63)
  display.drawFastHLine(0, 54, 128, 1);
  display.setCursor(3, 56);
  display.printf("REC #%-4u  [R/C: Menu]", totalRecordsLogged);
}

// ------------------------------------------------------------------------------
// Screen 2: Main Navigation Menu (Soft Moving Selection Pill)
// ------------------------------------------------------------------------------
void renderMainMenu() {
  display.setTextSize(1);

  if (menuCursor < menuScrollOffset) {
    menuScrollOffset = menuCursor;
  }
  if (menuCursor >= menuScrollOffset + 4) {
    menuScrollOffset = menuCursor - 3;
  }

  float targetY = 12.0f + ((float)(menuCursor - menuScrollOffset) * 10.0f);
  animMenuCursorY += (targetY - animMenuCursorY) * 0.40f;
  if (abs(animMenuCursorY - targetY) < 0.2f) {
    animMenuCursorY = targetY;
  }

  int pillY = (int)round(animMenuCursorY);
  display.fillRoundRect(2, pillY, 118, 9, 2, 1);

  for (int i = 0; i < 4; i++) {
    int itemIdx = menuScrollOffset + i;
    if (itemIdx >= TOTAL_MENU_ITEMS) break;

    int y = 12 + (i * 10);
    bool isSelected = (itemIdx == menuCursor);

    if (isSelected) {
      display.setTextColor(0, 1);
      display.setCursor(5, y + 1);
      display.print("> ");
      display.print(menuItems[itemIdx]);
      display.setTextColor(1, 0);
    } else {
      display.setTextColor(1, 0);
      display.setCursor(5, y + 1);
      display.print("  ");
      display.print(menuItems[itemIdx]);
    }
  }

  display.drawFastVLine(124, 12, 40, 1);
  float targetThumbY = 12.0f + ((float)menuCursor * (40.0f - 8.0f)) / (float)(TOTAL_MENU_ITEMS - 1);
  animScrollThumbY += (targetThumbY - animScrollThumbY) * 0.35f;
  display.fillRect(123, (int)round(animScrollThumbY), 3, 8, 1);

  display.drawFastHLine(0, 54, 128, 1);
  display.setCursor(4, 56);
  display.print("R/C:Select  L:Home");
}

// ------------------------------------------------------------------------------
// Screen 3: MicroSD Station Log Browser
// ------------------------------------------------------------------------------
void renderViewSDLogs() {
  display.setTextSize(1);
  display.setTextColor(1, 0);

  display.setCursor(2, 0);
  display.print("SD STATION LOGS");
  display.drawFastHLine(0, 10, 128, 1);

  if (!sdAvailable || logTotalRecords == 0) {
    display.setCursor(12, 26);
    display.print("No MicroSD Logs");
    display.setCursor(12, 38);
    display.print("Insert FAT32 Card");
    display.drawFastHLine(0, 53, 128, 1);
    display.setCursor(4, 55);
    display.print("C: Back to Menu");
    return;
  }

  display.setCursor(4, 13);
  display.printf("Record %d of %d", logBrowserIndex, logTotalRecords);

  int c1 = logCachedLine.indexOf(',');
  int c2 = logCachedLine.indexOf(',', c1 + 1);
  int c3 = logCachedLine.indexOf(',', c2 + 1);
  int c4 = logCachedLine.indexOf(',', c3 + 1);
  int c5 = logCachedLine.indexOf(',', c4 + 1);

  if (c1 > 0 && c2 > 0 && c3 > 0 && c4 > 0) {
    String tStr = logCachedLine.substring(c1 + 1, c2);
    String tempStr = logCachedLine.substring(c2 + 1, c3);
    String pressStr = logCachedLine.substring(c3 + 1, c4);
    String altStr = (c5 > 0) ? logCachedLine.substring(c4 + 1, c5) : logCachedLine.substring(c4 + 1);

    display.setCursor(4, 24);
    display.printf("Alt : %s m", altStr.c_str());

    display.setCursor(4, 34);
    display.printf("Baro: %s hPa", pressStr.c_str());

    display.setCursor(4, 44);
    display.printf("Temp: %s C", tempStr.c_str());
  } else {
    display.setCursor(4, 30);
    display.print(logCachedLine.substring(0, 20));
  }

  display.drawFastHLine(0, 54, 128, 1);
  display.setCursor(4, 56);
  display.print("UP/DN:Scroll    L:Back");
}

// ------------------------------------------------------------------------------
// Screen 4: Precision Altitude & QNH Calibration
// ------------------------------------------------------------------------------
void renderAltitudeCal() {
  display.setTextSize(1);
  display.setTextColor(1, 0);

  display.setCursor(2, 0);
  display.print("ALTIMETER CALIB");
  display.drawFastHLine(0, 10, 128, 1);

  if (!currentData.sensorOk || isnan(currentData.altitude)) {
    display.setCursor(12, 26);
    display.print("Sensor Disconnected");
    display.setCursor(12, 38);
    display.print("Connect BMP280 I2C");
    display.drawFastHLine(0, 53, 128, 1);
    display.setCursor(4, 55);
    display.print("C: Back to Menu");
    return;
  }

  if (calSavedMessage) {
    if (millis() - calSavedTime < 1500) {
      display.fillRect(4, 14, 120, 36, 1);
      display.setTextColor(0, 1);
      display.setCursor(16, 22);
      display.print("CALIBRATION SAVED");
      display.setCursor(20, 34);
      display.print("STORED TO FLASH!");
      display.setTextColor(1, 0);

      display.drawFastHLine(0, 54, 128, 1);
      display.setCursor(4, 56);
      display.print("Saved to ESP32 NVS");
      return;
    } else {
      calSavedMessage = false;
    }
  }

  display.setCursor(4, 14);
  display.print("Elev: ");
  if (calMode == 0) {
    display.fillRect(38, 13, 62, 9, 1);
    display.setTextColor(0, 1);
    display.printf("%6.1f m", currentData.stationElevation);
    display.setTextColor(1, 0);
    display.setCursor(102, 14);
    display.print("*SEL");
  } else {
    display.printf("%6.1f m", currentData.stationElevation);
  }

  display.setCursor(4, 25);
  display.print("QNH : ");
  if (calMode == 1) {
    display.fillRect(38, 24, 62, 9, 1);
    display.setTextColor(0, 1);
    display.printf("%6.2f", currentData.seaLevelPressure);
    display.setTextColor(1, 0);
    display.setCursor(102, 25);
    display.print("*SEL");
  } else {
    display.printf("%6.2f hPa", currentData.seaLevelPressure);
  }

  display.setCursor(4, 36);
  display.printf("P:%.1fhPa T:%.1fC", currentData.pressure, currentData.temperature);

  display.setCursor(4, 45);
  display.printf("Live Alt: %6.1f m", currentData.altitude);

  display.drawFastHLine(0, 54, 128, 1);
  display.setCursor(2, 56);
  display.print("C:Mode R:Save L:Back");
}

// ------------------------------------------------------------------------------
// Screen 5: Aero Strobe Mode Selector
// ------------------------------------------------------------------------------
void renderStrobeMenu() {
  display.setTextSize(1);
  display.setTextColor(1, 0);

  display.setCursor(2, 0);
  display.print("AERO STROBE");
  display.drawFastHLine(0, 10, 128, 1);

  if (strobeMenuCursor < strobeScrollOffset) {
    strobeScrollOffset = strobeMenuCursor;
  }
  if (strobeMenuCursor >= strobeScrollOffset + 4) {
    strobeScrollOffset = strobeMenuCursor - 3;
  }

  float targetStrobeY = 13.0f + ((float)(strobeMenuCursor - strobeScrollOffset) * 10.0f);
  animStrobeCursorY += (targetStrobeY - animStrobeCursorY) * 0.38f;
  if (abs(animStrobeCursorY - targetStrobeY) < 0.2f) {
    animStrobeCursorY = targetStrobeY;
  }

  int pillY = (int)round(animStrobeCursorY);
  display.fillRoundRect(0, pillY - 1, 120, 10, 2, 1);

  for (int i = 0; i < 4; i++) {
    int itemIdx = strobeScrollOffset + i;
    if (itemIdx >= TOTAL_STROBE_MODES) break;

    int y = 13 + (i * 10);
    bool isHighlighted = (itemIdx == strobeMenuCursor);
    bool isActive = (itemIdx == (int)currentStrobeMode);

    if (isHighlighted) {
      display.setTextColor(0, 1);
      display.setCursor(4, y);
      display.printf("> %-13s", strobeNames[itemIdx]);
      if (isActive) {
        display.setCursor(100, y);
        display.print("[ON]");
      }
      display.setTextColor(1, 0);
    } else {
      display.setTextColor(1, 0);
      display.setCursor(4, y);
      display.printf("  %-13s", strobeNames[itemIdx]);
      if (isActive) {
        display.setCursor(100, y);
        display.print("[ON]");
      }
    }
  }

  display.drawFastVLine(125, 12, 40, 1);
  float targetThumbY = 12.0f + ((float)strobeMenuCursor * (40.0f - 8.0f)) / (float)(TOTAL_STROBE_MODES - 1);
  animStrobeThumbY += (targetThumbY - animStrobeThumbY) * 0.35f;
  display.fillRect(124, (int)round(animStrobeThumbY), 3, 8, 1);

  display.drawFastHLine(0, 54, 128, 1);
  display.setCursor(4, 56);
  display.print("UP/DN:Active   C:Back");
}

// ------------------------------------------------------------------------------
// Screen 6: System & Diagnostics
// ------------------------------------------------------------------------------
void renderSystemInfo() {
  display.setTextSize(1);
  display.setTextColor(1, 0);

  display.setCursor(2, 0);
  display.print("SYSTEM INFO");
  display.drawFastHLine(0, 10, 128, 1);

  display.setCursor(4, 13);
  display.printf("BMP: %s (0x%02X)", currentData.sensorOk ? "OK" : "OFFLINE", currentData.i2cAddress);

  display.setCursor(4, 23);
  if (currentGps.fixValid) {
    display.printf("GPS: 3D Lock (%u S)", currentGps.satellites);
  } else if (currentGps.detected) {
    display.printf("GPS: OK (%u S seen)", currentGps.satellites);
  } else {
    display.printf("GPS: Scan RX G%d", GPS_RX_PIN);
  }

  display.setCursor(4, 33);
  display.printf("LED: W:%d G:%d(%s) O:%d",
                 SMD_LED_WHITE_PIN,
                 SMD_LED_GREEN_PIN,
                 currentData.sensorOk ? "3x" : "--",
                 SMD_LED_ORANGE_PIN);

  display.setCursor(4, 43);
  uint32_t sec = millis() / 1000;
  display.printf("Up : %02u:%02u:%02u", sec / 3600, (sec % 3600) / 60, sec % 60);

  display.drawFastHLine(0, 54, 128, 1);
  display.setCursor(4, 56);
  display.print("C: Back to Menu");
}

// ------------------------------------------------------------------------------
// Screen: GPS Navigation & Geodetic Fix Display
// ------------------------------------------------------------------------------
void renderGPSNav() {
  display.setTextSize(1);
  display.setTextColor(1, 0);

  // Top Title Bar with Live GPS State
  display.setCursor(2, 0);
  display.print("GPS NAV");
  display.setCursor(68, 0);
  if (currentGps.fixValid) {
    display.printf("[%2u SATS 3D]", currentGps.satellites);
  } else if (currentGps.detected) {
    display.printf("[ACQ:%2u SAT]", currentGps.satellites);
  } else {
    display.print("[NO SIGNAL]");
  }
  display.drawFastHLine(0, 9, 128, 1);

  if (!currentGps.detected) {
    // --------------------------------------------------------------------------
    // State 1: Hardware Disconnected / No NMEA Stream Detected
    // --------------------------------------------------------------------------
    display.setCursor(2, 12);
    display.print("Status: DISCONNECTED");

    display.setCursor(2, 22);
    display.printf("Module: NEO-6M (G%d)", currentGps.activeRxPin);

    display.setCursor(2, 32);
    display.printf("Wire  : GPS TX -> G%d", currentGps.activeRxPin);

    display.setCursor(2, 42);
    display.print("Power : 3.3V/5V & GND");

    display.drawFastHLine(0, 52, 128, 1);
    display.setCursor(2, 55);
    display.print("L/C:Back   [NO SIGNAL]");
    return;
  }

  if (!currentGps.fixValid) {
    // --------------------------------------------------------------------------
    // State 2: Hardware Connected & Streaming NMEA, Acquiring Satellite Fix
    // --------------------------------------------------------------------------
    display.setCursor(2, 12);
    display.print("Status: ACQUIRING LOCK");

    display.setCursor(2, 22);
    if (currentGps.satellites > 0) {
      display.printf("Sats  : %u Tracked", currentGps.satellites);
    } else {
      display.print("Sats  : Searching Sky...");
    }

    display.setCursor(2, 32);
    display.printf("Stream: %ub (Live OK)", currentGps.detectedBaud);

    display.setCursor(2, 42);
    display.print("Tip   : Move Near Window");

    display.drawFastHLine(0, 52, 128, 1);
    display.setCursor(2, 55);
    display.printf("L/C:Back  Chr:%-5u", (uint16_t)(gps.charsProcessed() % 100000));
    return;
  }

  // --------------------------------------------------------------------------
  // State 3: 3D Fix Locked - Authentic Real-Time Satellite Telemetry
  // --------------------------------------------------------------------------
  display.setCursor(2, 11);
  display.printf("LAT: %.5f %c", abs(currentGps.latitude), currentGps.latitude >= 0 ? 'N' : 'S');

  display.setCursor(2, 20);
  display.printf("LON: %.5f %c", abs(currentGps.longitude), currentGps.longitude >= 0 ? 'E' : 'W');

  display.setCursor(2, 29);
  display.printf("ALT: %4.0fm  SPD: %3.1f", currentGps.gpsAltitude, currentGps.speedKmh);

  display.setCursor(2, 38);
  display.printf("SAT: %-2u    HDOP: %.1f", currentGps.satellites, currentGps.hdop);

  display.setCursor(2, 47);
  if (gps.time.isValid()) {
    display.printf("UTC: %02d:%02d:%02d Lock", gps.time.hour(), gps.time.minute(), gps.time.second());
  } else {
    display.print("UTC: Syncing... 3D");
  }

  display.drawFastHLine(0, 56, 128, 1);
  display.setCursor(2, 57);
  display.print("L/C:Back  [3D LOCKED]");
}

void initGPS() {
  Serial.printf("[GPS] Initializing Hardware UART%d on RX: GPIO %d, TX: GPIO %d at %u baud...\n",
                GPS_UART_PORT, GPS_RX_PIN, GPS_TX_PIN, GPS_BAUD_RATE);
  SerialGPS.begin(GPS_BAUD_RATE, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  currentGps.activeRxPin = GPS_RX_PIN;
  currentGps.activeTxPin = GPS_TX_PIN;
  currentGps.detectedBaud = GPS_BAUD_RATE;
  currentGps.detected = false;
  currentGps.fixValid = false;
  currentGps.latitude = 0.0;
  currentGps.longitude = 0.0;
  currentGps.speedKmh = 0.0f;
  currentGps.gpsAltitude = 0.0f;
  currentGps.satellites = 0;
  currentGps.hdop = 99.9f;
  currentGps.lastByteTime = 0;
  currentGps.totalBytesReceived = 0;
  currentGps.sentencesParsed = 0;
  Serial.println("[GPS] Ready. Listening non-blockingly for NEO-6M NMEA stream.");
}

void updateGPSData() {
  currentGps.lastByteTime = millis();

  if (gps.location.isValid()) {
    currentGps.latitude = gps.location.lat();
    currentGps.longitude = gps.location.lng();
    currentGps.fixValid = true;
    currentGps.lastFixTime = millis();

    // Auto-save last known GPS position to NVS Flash
    if (millis() - lastGpsNvsSaveTime >= 60000 || !currentGps.savedToFlash) {
      lastGpsNvsSaveTime = millis();
      currentGps.savedToFlash = true;
      preferences.begin("aerosense", false);
      preferences.putDouble("lat", currentGps.latitude);
      preferences.putDouble("lon", currentGps.longitude);
      preferences.end();
    }
  } else {
    // When satellites are lost or acquiring, zero out coordinates to prevent fake data
    currentGps.fixValid = false;
    currentGps.latitude = 0.0;
    currentGps.longitude = 0.0;
  }

  if (gps.altitude.isValid()) {
    currentGps.gpsAltitude = gps.altitude.meters();
  } else {
    currentGps.gpsAltitude = 0.0f;
  }

  if (gps.speed.isValid()) {
    currentGps.speedKmh = gps.speed.kmph();
  } else {
    currentGps.speedKmh = 0.0f;
  }

  if (gps.satellites.isValid()) {
    currentGps.satellites = gps.satellites.value();
  } else {
    currentGps.satellites = 0;
  }

  if (gps.hdop.isValid()) {
    currentGps.hdop = gps.hdop.hdop();
  } else {
    currentGps.hdop = 99.9f;
  }
}

void transitionToScreen(AppScreen newScreen) {
  if (currentScreen == newScreen) return;

  // Soft Micro-Curtain Wipe Transition for smooth, fluid sub-menu switches
  for (int step = 0; step <= 32; step += 10) {
    updateStrobe();
    display.fillRect(0, 0, 128, step, 0);
    display.fillRect(0, 64 - step, 128, step, 0);
    display.display();
    delay(8);
  }

  currentScreen = newScreen;
  display.clearDisplay();
  display.display();
}

// ==============================================================================
// USB Web Serial & Internet Synchronization Command Engine
// ==============================================================================

void processSerialCommands() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      if (serialCmdBuffer.length() > 0) {
        handleIncomingCommand(serialCmdBuffer);
        serialCmdBuffer = "";
      }
    } else {
      if (serialCmdBuffer.length() < 128) {
        serialCmdBuffer += c;
      }
    }
  }
}

void handleIncomingCommand(const String& cmd) {
  if (cmd.startsWith("$CAL,QNH,")) {
    float qnh = cmd.substring(9).toFloat();
    if (qnh >= 850.0f && qnh <= 1100.0f) {
      currentData.seaLevelPressure = qnh;
      if (currentData.sensorOk && !isnan(currentData.filteredPressure)) {
        float tempK = currentData.temperature + 273.15f;
        currentData.stationElevation = ((powf(currentData.seaLevelPressure / currentData.filteredPressure, HYPSOMETRIC_EXPONENT) - 1.0f) * tempK) / HYPSOMETRIC_LAPSE_RATE;
        currentData.altitude = currentData.stationElevation;
      }
      saveCalibrationToFlash();
      calSavedMessage = true;
      calSavedTime = millis();
      internetSyncActive = true;
      Serial.printf("$CAL_OK,QNH,%.2f,ELEV,%.1f,ALT,%.1f\n",
                    currentData.seaLevelPressure, currentData.stationElevation, currentData.altitude);
    } else {
      Serial.println("$CAL_ERR,INVALID_QNH");
    }
  } else if (cmd.startsWith("$CAL,ELEV,")) {
    float elev = cmd.substring(10).toFloat();
    if (elev >= -500.0f && elev <= 9000.0f) {
      currentData.stationElevation = elev;
      if (currentData.sensorOk && !isnan(currentData.filteredPressure)) {
        float tempK = currentData.temperature + 273.15f;
        currentData.seaLevelPressure = currentData.filteredPressure *
          powf(1.0f + (HYPSOMETRIC_LAPSE_RATE * currentData.stationElevation) / tempK, 1.0f / HYPSOMETRIC_EXPONENT);
        currentData.altitude = currentData.stationElevation;
      }
      saveCalibrationToFlash();
      calSavedMessage = true;
      calSavedTime = millis();
      internetSyncActive = true;
      Serial.printf("$CAL_OK,ELEV,%.1f,QNH,%.2f,ALT,%.1f\n",
                    currentData.stationElevation, currentData.seaLevelPressure, currentData.altitude);
    } else {
      Serial.println("$CAL_ERR,INVALID_ELEV");
    }
  } else if (cmd == "$CAL,GET") {
    Serial.printf("$CAL_STATUS,%.2f,%.1f,%.1f,%.2f,%.2f\n",
                  currentData.seaLevelPressure, currentData.stationElevation, currentData.altitude, currentData.pressure, currentData.temperature);
  }
}
