**26. Architecture & Scaling Diagram Set**

*How to attach: Copy each diagram block into [mermaid.live](https://mermaid.live), screenshot the rendered output, and paste the image into your Word document under this section.*

---

**Diagram 1: Current Three-Tier System Architecture**

```mermaid
graph TB
    subgraph "Tier 1: Client Layer"
        A["Student Web App<br/>(React/Vite)"]
        B["Kiosk UI<br/>(React/Chromium)"]
    end

    subgraph "Tier 2: Cloud Layer (Supabase)"
        C["PostgreSQL 15<br/>(print_jobs table)"]
        D["Object Storage<br/>(S3-compatible)"]
        E["Realtime Engine<br/>(WebSocket Push)"]
    end

    subgraph "Tier 3: Edge Layer (Raspberry Pi 4)"
        F["Node.js Agent<br/>(PM2 managed)"]
        G["LibreOffice Headless<br/>(soffice.bin)"]
        H["pdf-lib<br/>(Booklet Imposition)"]
        I["CUPS Spooler<br/>(IPP Everywhere)"]
    end

    J["Campus Laser Printer"]

    A -->|"SHA-256 Upload"| D
    A -->|"Insert Job Record"| C
    B -->|"PIN Verification"| C
    B -->|"Payment Confirm"| C
    C -->|"UPDATE Event"| E
    E -->|"WebSocket Push ~150ms"| F
    F -->|"Download File"| D
    F --> G
    G -->|"PDF Output"| H
    H -->|"Imposed PDF"| I
    I -->|"lp command"| J
```

---

**Diagram 2: Scaled Multi-Node Campus Deployment**

```mermaid
graph TB
    subgraph "Firebase CDN"
        WEB["Student Web App<br/>(Global CDN)"]
    end

    subgraph "Supabase Cloud (Single Instance)"
        DB["PostgreSQL<br/>(Shared Database)"]
        ST["Object Storage<br/>(Deduplicated)"]
        RT["Realtime Engine<br/>(200 connections)"]
    end

    subgraph "Campus Building A"
        PA1["Pi Agent 01"]
        K1["Kiosk Display 01"]
        PR1["Printer 01"]
        PA1 --> PR1
        K1 --> PA1
    end

    subgraph "Campus Building B"
        PA2["Pi Agent 02"]
        K2["Kiosk Display 02"]
        PR2["Printer 02"]
        PA2 --> PR2
        K2 --> PA2
    end

    subgraph "Campus Building C"
        PA3["Pi Agent 03"]
        K3["Kiosk Display 03"]
        PR3["Printer 03"]
        PA3 --> PR3
        K3 --> PA3
    end

    subgraph "Campus Library"
        PA4["Pi Agent 04"]
        K4["Kiosk Display 04"]
        PR4["Printer 04"]
        PA4 --> PR4
        K4 --> PA4
    end

    WEB -->|"Uploads"| ST
    WEB -->|"Job Records"| DB

    RT -->|"WebSocket"| PA1
    RT -->|"WebSocket"| PA2
    RT -->|"WebSocket"| PA3
    RT -->|"WebSocket"| PA4

    PA1 -->|"Download"| ST
    PA2 -->|"Download"| ST
    PA3 -->|"Download"| ST
    PA4 -->|"Download"| ST
```

---

**Diagram 3: Data Flow & Lifecycle Pipeline**

```mermaid
flowchart LR
    A["User Selects File"] --> B["Client Extracts<br/>Page Count (JSZip)"]
    B --> C["Client Generates<br/>SHA-256 Hash"]
    C --> D{"Duplicate<br/>Detected?"}
    D -->|"Yes"| E["Skip Upload<br/>(Reuse Existing)"]
    D -->|"No"| F["Upload to<br/>Supabase Storage"]
    E --> G["Insert print_job<br/>(Status: pending)"]
    F --> G
    G --> H["User Enters PIN<br/>at Kiosk"]
    H --> I["Payment Confirmed<br/>(Status: processing)"]
    I --> J["WebSocket Push<br/>to Pi Agent"]
    J --> K{"File Format?"}
    K -->|"PDF"| M["Direct Spool"]
    K -->|"Office/Image"| L["LibreOffice<br/>Conversion"]
    L --> M
    M --> N{"A3 Booklet?"}
    N -->|"Yes"| O["Saddle-Stitch<br/>Imposition"]
    N -->|"No"| P["Standard Print"]
    O --> P
    P --> Q["CUPS lp Command<br/>(IPP Everywhere)"]
    Q --> R["Physical Printout"]
    R --> S["Status: completed"]
    S --> T["24h Cleanup<br/>Cron Purge"]
```
