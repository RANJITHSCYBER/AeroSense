# ✈️ AeroSense — Precision Atmospheric Telemetry, Avionics & Predictive Meteorological Station

<p align="center">
  <img src="https://img.shields.io/badge/PlatformIO-ESP32-E6522C?style=for-the-badge&logo=platformio&logoColor=white" alt="PlatformIO ESP32" />
  <img src="https://img.shields.io/badge/Language-C%2B%2B17%20%2F%20JavaScript-00599C?style=for-the-badge&logo=c%2B%2B&logoColor=white" alt="C++17 and JS" />
  <img src="https://img.shields.io/badge/Sensor-Bosch%20GY--BMP280-008080?style=for-the-badge" alt="Bosch BMP280" />
  <img src="https://img.shields.io/badge/Navigation-NEO--6M%20GPS-blue?style=for-the-badge&logo=google-maps&logoColor=white" alt="NEO-6M GPS" />
  <img src="https://img.shields.io/badge/Display-1.3%22%20SH1106%20OLED-792EE5?style=for-the-badge" alt="SH1106 OLED" />
  <img src="https://img.shields.io/badge/Analytics-Past%20vs%20Present%20AI-success?style=for-the-badge" alt="Predictive AI" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="MIT License" />
</p>

---

## 📖 Executive Overview

**AeroSense** is an open-source, aviation-grade micro-meteorological telemetry system and time-series weather prediction suite built around the **Espressif ESP32**, **Bosch GY-BMP280-5V** high-precision barometric pressure and temperature sensor, a **1.3" 128x64 I2C OLED display (SH1106/SSD1306)**, a **MicroSD SPI storage engine**, and a **u-blox NEO-6M GPS module**.

AeroSense bridges embedded firmware with atmospheric physics. Instead of presenting raw pressure drift, AeroSense calculates:
1. **Temperature-Compensated Hypsometric Altitude** based on hydrostatic gas equations and local Sea-Level QNH.
2. **Empirical Zambretti Barometric Tendency Algorithms** cross-referenced with **WMO Code Table 0200** 3-hour pressure rate vectors ($dP/dt$ and $d^2P/dt^2$) to predict approaching frontal weather hours ahead of arrival.
3. **Psychrometric Cloud Base Lifting Condensation Level (LCL)** mapping condensation cloud ceilings.
4. **Tri-Color SMD Status & Aviation Strobe Lighting** engineered specifically for 0603/0805 SMD LEDs.
5. **NVS Flash Permanent Calibration Storage** ensuring custom ground elevation and regional QNH survive hardware reboots.
6. **Dual In-Browser Ground Stations**:
   - `web_dashboard/`: Real-time Leaflet.js GPS flight map, interactive waypoint telemetry table, high-density Chart.js curves, and 1-Click Open-Meteo internet QNH flash sync via Web Serial USB.
   - `weather_predictor/`: Deep meteorological time-series comparative engine analyzing past baseline logs vs present observations to extrapolate forward $+24$ hours.

---

## 🏗️ System Architecture & Dataflow

```
                      +---------------------------------------+
                      |         ESP32 Microcontroller         |
                      |   (240MHz Tensilica Dual-Core, NVS)   |
                      +-------------------+-------------------+
                                          |
        +---------------------------------+---------------------------------+
        |                                 |                                 |
 [Fast I2C Bus @ 400kHz]        [High-Speed SPI Bus]              [UART2 @ 9600 Baud]
   SDA: GPIO 21                   SCK:  GPIO 18                     RX: GPIO 34 (In)
   SCL: GPIO 22                   MISO: GPIO 19                     (Non-blocking NMEA)
        |                         MOSI: GPIO 23                             |
        +-- GY-BMP280 (0x76/0x77) CS:   GPIO 13                             |
        |   (16x Oversampling,            |                           NEO-6M GPS Module
        |    16x IIR Filter)       MicroSD Card (/aerosense.csv)      (Lat/Lon, Alt, Speed,
        +-- 1.3" SH1106 OLED       (Continuous 5s Telemetry Logs)      Satellites, HDOP)
            (Gliding Menu Pill,
             25 FPS Micro-Wipe)
        |
        +---------------------------------+---------------------------------+
        |                                 |                                 |
[5-Way Tactile PCB Navigation]   [Tri-Color SMD Aviation LEDs]      [USB Serial @ 115200]
   UP:     GPIO 26                  WHITE:  GPIO 2  (Aero Beacon)      $AERO Telemetry Stream
   DOWN:   GPIO 33                  GREEN:  GPIO 12 (Exec Triple)      $CAL Calibration Link
   CENTER: GPIO 32 (Home/Exit)      ORANGE: GPIO 14 (Stealth)                   |
   LEFT:   GPIO 25 (Back)                                                       v
   RIGHT:  GPIO 27 (Select/Save)                                       +-------------------+
                                                                       | Web Ground Suite  |
                                                                       | - web_dashboard/  |
                                                                       | - weather_predict |
                                                                       +-------------------+
```

---

## 📌 Hardware Pin Mapping & PCB Specification

All pins are assigned to ensure total compatibility with custom soldered PCB traces and boot strapping requirements.

### 1. SPI MicroSD Card Data Logger
| MicroSD Module Pin | ESP32 GPIO | Description / Mode |
|:---:|:---:|:---|
| **SCK**  | `GPIO 18` | Hardware SPI Clock |
| **MISO** | `GPIO 19` | Master-In Slave-Out (Data reading) |
| **MOSI** | `GPIO 23` | Master-Out Slave-In (Data writing) |
| **CS**   | `GPIO 13` | SPI Chip Select (Active Low) |
| **VCC**  | `5V` / `3.3V` | Power Supply |
| **GND**  | `GND` | Common Ground |

### 2. 5-Way Tactile Navigation Buttons (Internal `INPUT_PULLUP`)
All switches connect their GPIO pin directly to **GND**. Software applies a 35ms stable debounce filter.
| Button Switch | ESP32 GPIO | Firmware Navigation Function |
|:---:|:---:|:---|
| **UP**     | `GPIO 26` | Scroll Up / Increment Elevation & QNH / Previous SD Record |
| **DOWN**   | `GPIO 33` | Scroll Down / Decrement Elevation & QNH / Next SD Record |
| **CENTER** | `GPIO 32` | **Home / Exit** (Toggle between Live Telemetry & Menu) / Toggle Cal Mode |
| **LEFT**   | `GPIO 25` | **Back** (Return to previous menu screen) |
| **RIGHT**  | `GPIO 27` | **Select** (Enter submenu / Save calibration to NVS Flash) |

### 3. I2C Sensor & Display Bus (`400 kHz Fast-Mode`)
| Module Pin | ESP32 GPIO | Device Description |
|:---:|:---:|:---|
| **SDA** | `GPIO 21` | Shared I2C Data Line |
| **SCL** | `GPIO 22` | Shared I2C Clock Line |
| **BMP280** | Address `0x76` or `0x77` | Auto-probing Bosch GY-BMP280 Barometric Pressure & Temp |
| **OLED** | Address `0x3C` | 1.3" 128x64 SH1106 (or 0.96" SSD1306 via `USE_SH1106`) |

### 4. Tri-Color SMD Aviation Status & Strobe Engine
Designed with calibrated optical dwell pulses for **0603/0805 SMD LEDs**:
| SMD LED Color | ESP32 GPIO | Pattern | Cadence & Trigger Rule |
|:---:|:---:|:---:|:---|
| **White SMD** | **`GPIO 2`** (`D2`) | **Aero Beacon** | `75ms ON / 925ms OFF` (1.0s cycle) — Runs continuously on **Device Power-Up** (also configurable via OLED Aero Strobe menu) |
| **Green SMD** | **`GPIO 12`** | **Exec Triple** | `3x 40ms ON` (`60ms` gap) / `1200ms OFF` — Pulses when **GY-BMP280 sensor is detected & operational**; turns `OFF` if sensor is disconnected |
| **Orange SMD** | **`GPIO 14`** | **Stealth** | `35ms ON / 1965ms OFF` (2.0s cycle) — Runs continuously on **Device Power-Up** |

> **SMD LED Hardware Note**: Wire each pin (`GPIO 2`, `12`, `14`) through a $220\,\Omega$ to $330\,\Omega$ resistor to the **Anode (+)** of the SMD LED, with **Cathode (-)** to **GND**. Having `GPIO 12` active-HIGH to GND keeps the MTDI flash voltage strapping line safely grounded during boot.

### 5. GPS NEO-6M Geodetic Telemetry (Hardware UART2)
| NEO-6M Pin | ESP32 GPIO | Description |
|:---:|:---:|:---|
| **TX** | **`GPIO 34`** | GPS Serial TX $\to$ ESP32 RX (`GPIO 34` is an input-only pin, preserving output pins) |
| **RX** | *Unconnected* | Not required — NEO-6M automatically streams NMEA at 9600 baud upon power |
| **VCC** | `5V` / `3.3V` | Power Supply |
| **GND** | `GND` | Common Ground |

---

## 🧮 Atmospheric Physics & Mathematical Foundations

### 1. Temperature-Compensated Hypsometric Formula
Standard barometric altimeters assume a constant Sea-Level temperature ($15^\circ\text{C}$ / $288.15\text{ K}$), resulting in altitude errors exceeding $50\text{ m}$ during hot or cold weather. AeroSense computes altitude using real-time ambient temperature compensation derived from the hydrostatic equation:

$$h = \frac{T_{\text{ambient}} + 273.15}{L} \cdot \left[ \left(\frac{P_{\text{QNH}}}{P_{\text{filtered}}}\right)^{\frac{R \cdot L}{g}} - 1.0 \right]$$

Where:
* $P_{\text{filtered}}$ = Real-time low-pass filtered barometric pressure ($\text{hPa}$)
* $P_{\text{QNH}}$ = Local regional Mean Sea Level pressure ($\text{hPa}$)
* $T_{\text{ambient}}$ = In-situ temperature ($^\circ\text{C}$) measured by BMP280
* $L = 0.0065\text{ K/m}$ (Standard tropospheric lapse rate)
* $\frac{R \cdot L}{g} = 0.190263$ (Exact hypsometric exponent)

### 2. Dual-Mode Ground Truth Calibration Equations
When the user knows their local station ground elevation ($h_{\text{station}}$), the exact true local sea-level pressure ($P_{\text{QNH}}$) is calculated and saved to ESP32 Flash:

$$P_{\text{QNH}} = P_{\text{filtered}} \cdot \left( 1.0 + \frac{L \cdot h_{\text{station}}}{T_{\text{ambient}} + 273.15} \right)^{\frac{g}{R \cdot L}}$$

Where $\frac{g}{R \cdot L} = 5.25588$. Conversely, setting a known regional QNH computes the exact elevation:

$$h_{\text{station}} = \frac{(T_{\text{ambient}} + 273.15)}{L} \cdot \left[ \left( \frac{P_{\text{QNH}}}{P_{\text{filtered}}} \right)^{0.190263} - 1.0 \right]$$

### 3. Magnus-Tetens Psychrometric Dew Point Formulation
AeroSense derives dew point temperature ($T_d$) from ambient temperature and relative humidity:

$$\alpha(T, \text{RH}) = \frac{a \cdot T}{b + T} + \ln\left(\frac{\text{RH}}{100}\right)$$

$$T_d = \frac{b \cdot \alpha(T, \text{RH})}{a - \alpha(T, \text{RH})}$$

*(Constants: $a = 17.27$, $b = 237.7^\circ\text{C}$)*

### 4. Lifting Condensation Level (LCL Cloud Ceiling)
The cloud base ceiling height above ground level (AGL) is calculated using the dew point spread:

$$\text{LCL} \approx 125 \cdot (T - T_d) \text{ meters AGL}$$

### 5. WMO Standard 3-Hour Tendency & Diurnal Tide Correction
AeroSense samples barometric tendency according to **WMO Code Table 0200**:
* **Code 0-2 (Rising)**: Steady or rapid pressure rise ($+0.5$ to $> +2.0\text{ hPa/3h}$) $\to$ Improving synoptic conditions.
* **Code 4 (Steady)**: $\pm 0.5\text{ hPa/3h}$ $\to$ Stable air mass.
* **Code 6-8 (Falling)**: Rapid pressure drop ($< -2.0\text{ hPa/3h}$) $\to$ Convective squall lines / incoming storm front alert.
* **Semi-Diurnal Solar Thermal Tide Extraction**: Filters out normal 10:00 and 16:00 atmospheric thermal expansion fluctuations ($\approx 1.2\text{ hPa}$ amplitude) to eliminate false storm warnings:

$$\Delta P_{\text{synoptic}} = \Delta P_{3h} - A_{S2} \cdot \cos(2\omega t - \phi_2)$$

---

## 📟 On-Device OLED UI Navigation Engine

The 1.3" 128x64 OLED display features a **Soft-Motion Gliding Selection Pill** and **Curtain Wipe Transitions** rendered at 25 FPS without display flicker.

```
                           +---------------------------+
                           |    1. LIVE TELEMETRY      |
                           |  - Weather Icon & Status  |
                           |  - Hypsometric Alt & QNH  |
                           |  - Real Baro & Temp Grid  |
                           |  - GPS Fix & SD REC State |
                           +-------------+-------------+
                                         | [CENTER / RIGHT]
                                         v
                           +---------------------------+
                           |      2. MAIN MENU         |
                           |  > Live Telemetry         |
                           |    GPS Navigation         |
                           |    SD Station Logs        |
                           |    Altimeter Cal          |
                           |    Aero Strobe            |
                           |    System Info            |
                           +-------------+-------------+
             +-----------------+---------+---------+-----------------+
             |                 |                   |                 |
             v                 v                   v                 v
     +---------------+ +---------------+   +---------------+ +---------------+
     | GPS NAV       | | SD LOGS       |   | ALTIMETER CAL | | AERO STROBE   |
     | - Lat / Lon   | | - Browse lines|   | - Elevation   | | - Airliner 2x |
     | - Speed (km/h)| | - Live cursor |   |   (1m step)   | | - Exec Triple |
     | - Satellites  | | - CSV parsing |   | - QNH mode    | | - Aero Beacon |
     | - HDOP / Lock | |   Alt/Baro/Tmp|   | - Save to NVS | | - Stealth     |
     +---------------+ +---------------+   +---------------+ +---------------+
```

### Soft-Motion Easing Interpolator
Menu cursor movement uses continuous exponential smoothing:
```cpp
float targetY = 12.0f + ((float)(menuCursor - menuScrollOffset) * 10.0f);
animMenuCursorY += (targetY - animMenuCursorY) * 0.40f;
```

---

## 🌐 Dual Web Ground Stations

AeroSense includes two standalone client-side web platforms that operate in any modern web browser without server installations.

### 1. AeroSense Station Log Analyzer (`web_dashboard/index.html`)
* **Leaflet.js GPS Flight Map**: Renders real-time GPS telemetry from SD card logs or live USB stream with a pulsing radar marker, flight path polylines, and waypoint popups.
* **1-Click Open-Meteo Internet QNH Sync**: Auto-detects station coordinates, queries Open-Meteo for regional `pressure_msl` and topographic elevation, and transmits `$CAL,QNH,<val>` to flash memory over Web Serial USB.
* **Interactive Telemetry Table**: Searchable, filterable log records with a "View on Map" shortcut that pans and zooms directly to that exact waypoint.
* **Atmospheric Tropospheric Flow Bar**: Vertical gradient tracking boundary layer, rain zone, condensation level, and free troposphere.
* **4 High-Definition Chart.js Visualizations**: Altitude profile, pressure alert thresholds, temp/humidity correlation, and hypsometric lapse curves.

### 2. Deep Meteorological Predictor (`weather_predictor/index.html`)
* **Past vs Present Time-Series Ingestion**: Ingests historical baseline logs and present observation logs, or auto-splits a single continuous SD log file ($60\%$ past baseline, $40\%$ present).
* **Synoptic Baseline Anomaly Detection**: Calculates baseline mean $\bar{P}$ and standard deviation $\sigma_P$ to identify deep atmospheric depressions.
* **Multi-Horizon Forecast Timeline**:
  * **Nowcast (1 - 3 Hours)**: Immediate barometric gradient, precipitation probability %, and wind gust alerts.
  * **Near-Term (3 - 6 Hours)**: Frontal passage arrival and cloud base lowering.
  * **Mid-Term (6 - 12 Hours)**: Rain intensity and synoptic transition.
  * **Synoptic Outlook (12 - 24 Hours)**: High/low pressure ridge development with forward curve projection.
* **Diagnostic Mathematical Audit Panel**: Displays live mathematical evaluations of the hypsometric hydrostatic equations, WMO 3-hour tendency, and moisture psychrometrics.

---

## 📡 Live Telemetry & Serial Command Protocol

### Inbound Serial Protocol (USB $\to$ ESP32 at `115200 Baud`)
* `$CAL,QNH,<pressure_msl>`: Sets custom Sea-Level QNH ($850.0 - 1100.0\text{ hPa}$), auto-recalculates ground elevation, and saves permanently to NVS Flash (`Preferences`).
  * Response: `$CAL_OK,QNH,<qnh>,ELEV,<elev>,ALT,<alt>`
* `$CAL,ELEV,<elevation_m>`: Sets known station elevation ($-500.0 - 9000.0\text{ m}$), auto-derives exact Sea-Level QNH, and saves to NVS Flash.
  * Response: `$CAL_OK,ELEV,<elev>,QNH,<qnh>,ALT,<alt>`
* `$CAL,GET`: Queries active calibration parameters and live barometric readings.
  * Response: `$CAL_STATUS,<qnh>,<elev>,<alt>,<press>,<temp>`

### Outbound Real-Time Stream (ESP32 $\to$ USB at 1 Hz)
```text
$AERO,<time_s>,<temp_C>,<press_hPa>,<alt_m>,<qnh_hPa>,<lat>,<lon>,<speed_kmh>,<sats>,<fix>
```
*Example:*
```text
$AERO,128,24.35,912.80,920.40,1013.25,12.971598,77.594562,0.0,8,1
```

---

## 📂 Repository File Structure

```text
AeroSense/
├── include/
│   ├── config.h             # Pin assignments, I2C addresses, and atmospheric constants
│   └── README               # Include directory guidelines
├── src/
│   └── main.cpp             # Complete ESP32 firmware (Sensors, SD, OLED, GPS, SMD Strobe, NVS)
├── lib/
│   └── README               # PlatformIO private libraries directory
├── test/
│   └── README               # Unit test directory
├── weather_predictor/       # Deep Meteorological Time-Series Predictor
│   ├── index.html           # Past vs Present UI & multi-horizon forecast layout
│   ├── style.css            # High-contrast aerospace observatory theme
│   └── app.js               # Synoptic algorithms, WMO 0200, Chart.js forward curves
├── web_dashboard/           # Station Flight Deck & SD Card Log Analyzer
│   ├── index.html           # Leaflet.js GPS map, interactive table, charts layout
│   ├── style.css            # Dark/light aviation flight deck stylesheet
│   └── app.js               # Web Serial USB streaming, Open-Meteo sync, Leaflet map
├── .gitignore               # Clean repository ignore rules (builds, caches, temp files)
├── platformio.ini           # PlatformIO project configuration & library dependencies
└── README.md                # Comprehensive system documentation
```

---

## 🚀 Building & Uploading Firmware

### Prerequisites
* [PlatformIO IDE](https://platformio.org/) (VS Code Extension) or PlatformIO Core CLI.
* Connected ESP32 Dev Module via micro-USB / Type-C.

### Compilation & Flash
```powershell
# 1. Clone repository
git clone https://github.com/RANJITHSCYBER/AeroSense.git
cd AeroSense

# 2. Compile firmware
platformio run

# 3. Flash to ESP32
platformio run --target upload

# 4. Open serial telemetry monitor (115200 baud)
platformio device monitor
```

---

## 📤 Uploading to Your GitHub Repository

To push this codebase to your own GitHub account:

```powershell
# 1. Initialize git in the project root
git init

# 2. Stage all files (clean .gitignore already configured)
git add .

# 3. Commit the project
git commit -m "Initial commit: AeroSense firmware, dual web suites, and complete documentation"

# 4. Rename default branch to main
git branch -M main

# 5. Link your GitHub remote repository (replace with your repo URL)
git remote add origin https://github.com/RANJITHSCYBER/AeroSense.git

# 6. Push codebase to GitHub
git push -u origin main
```

---

## 📜 License
This project is licensed under the **MIT License** — you are free to modify, distribute, and integrate it into personal and commercial avionics projects.
