# GreenNext Backend & Analytics Google Apps Script Integration

This directory contains the production-ready Google Apps Script backend (`Code.gs`) that powers the GreenNext digital infrastructure platform.

---

## 1. System Architecture

```
GreenNext Website (User Interactivity & Inquiry Forms)
      │
      ├── Telemetry & Form Submissions (JSON POST via fetch / sendBeacon)
      ▼
Google Apps Script Web App Endpoint (`doPost`)
      │
      ├── Writes raw events & inquiries
      ▼
Spreadsheet 1: GreenNext Raw Data (`14ciH1aNzWIJHJkQ5rYCdrEhci3KYMjrTSeY3QMaerVI`)
  ├── 10 Behavioral Tabs (Navigation, Regions, Infrastructure, Energy, Automation,
  │                       Solutions, Industries, Locations, AI Assistant, CTA Interactions)
  ├── `Quick_Inquiries` (Dedicated quick-lead submissions)
  ├── `Contact_Submissions` (Dedicated consultative long-form inquiries)
  └── `Session_Intelligence` (One anonymous row per session, including traffic attribution)
      │
      ├── Derived Aggregation & Funnel Computation (`updateAnalyticsSpreadsheet`)
      ▼
Spreadsheet 2: GreenNext Analytics (`1AYA5NsOTwSG7hC_5M9pxAeZCTpbZZ_-y7Pil5TDYt0o`)
  ├── `Executive_Summary` (Core KPIs, Traffic Intelligence, Sessions, Inquiries, Recent Lead Log)
  ├── `Regional_Analytics` (Madurai, Coimbatore, Trichy, Mangalore Breakdown)
  ├── `CTA_and_Funnel` (Conversion Funnel & CTA Click Distribution)
  ├── `Infrastructure_and_Energy` (Stack layers, Energy flow, and Automation nodes)
  └── `AI_Assistant_Telemetry` (Chatbot opens, sanitized topics, suggestions clicked)
```

---

## 2. Key Features

1. **Dual-Destination Ingestion**:
   - Captures form submissions into dedicated sheets (`Quick_Inquiries` and `Contact_Submissions`) with complete contact parameters.
   - Simultaneously writes a privacy-safe high-intent event to `CTA Interactions` (with no PII) to preserve unified behavioral tracking.
2. **Derived Intelligence Without Machine Over-Engineering**:
   - No arbitrary lead scores or fake AI intent claims.
   - Calculates real conversion rates from observed visitors, modal opens, and completed submissions.
3. **No Email Automation**:
   - Complies with trainer guidelines: independent of MailApp, internal email triggers, or user confirmation emails.
4. **Resilient Backward & Forward Compatibility**:
   - Supports existing 5-column behavioral tabs without disrupting historical data.
   - Website includes automatic fallback handling so inquiries succeed even if the deployed Apps Script version has not yet been refreshed.
5. **Traffic Intelligence**:
   - Reuses the existing anonymous session ID and `Session_Intelligence` sheet; it does not add another endpoint or raw-data sheet.
   - Stores the original landing page, sanitized referrer origin/domain, classified source/medium/channel, UTM values, and organic/paid flags alongside Session Intelligence.
   - Adds deduplicated source, medium, channel, referral, landing-page, and campaign summaries to the existing `Executive_Summary` tab. Historical sessions without attribution are left unclassified.

---

## 3. How to Deploy the Apps Script

1. Open **Spreadsheet 1 (Raw Data)** in Google Sheets:
   - URL: `https://docs.google.com/spreadsheets/d/14ciH1aNzWIJHJkQ5rYCdrEhci3KYMjrTSeY3QMaerVI/edit`
2. Navigate to **Extensions > Apps Script** in the top menu.
3. Replace the existing code in the editor with the complete contents of `google-apps-script/Code.gs`.
4. Click **Save** (💾 icon).
5. Click **Deploy > Manage deployments**:
   - Click the pencil icon (Edit) on the active Web app deployment.
   - Under **Version**, select **New version**.
   - Click **Deploy**.
6. (Optional) Run `updateAnalyticsSpreadsheet` once manually inside the Apps Script editor to initialize the tabs in Spreadsheet 2 (Analytics).
7. (Optional Time-Driven Trigger):
   - In Apps Script, go to **Triggers (alarm clock icon on left sidebar) > Add Trigger**.
   - Function: `updateAnalyticsSpreadsheet`.
   - Event source: `Time-driven`.
   - Type: `Minutes timer` (e.g. Every 15 minutes) or `Hour timer`.
   - Click **Save**.
