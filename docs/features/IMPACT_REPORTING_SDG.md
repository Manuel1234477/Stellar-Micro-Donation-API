# Donation Impact Reporting with SDG Category Mapping

Donations can be tagged with UN Sustainable Development Goal (SDG) categories. The API computes impact metrics per SDG and generates exportable reports for grant reporting and donor communications.

## SDG Categories

All 17 UN SDGs are supported with codes `SDG1`–`SDG17`:

| Code | Goal | Title |
|---|---|---|
| SDG1 | 1 | No Poverty |
| SDG2 | 2 | Zero Hunger |
| SDG3 | 3 | Good Health and Well-being |
| SDG4 | 4 | Quality Education |
| SDG5 | 5 | Gender Equality |
| SDG6 | 6 | Clean Water and Sanitation |
| SDG7 | 7 | Affordable and Clean Energy |
| SDG8 | 8 | Decent Work and Economic Growth |
| SDG9 | 9 | Industry, Innovation and Infrastructure |
| SDG10 | 10 | Reduced Inequalities |
| SDG11 | 11 | Sustainable Cities and Communities |
| SDG12 | 12 | Responsible Consumption and Production |
| SDG13 | 13 | Climate Action |
| SDG14 | 14 | Life Below Water |
| SDG15 | 15 | Life on Land |
| SDG16 | 16 | Peace, Justice and Strong Institutions |
| SDG17 | 17 | Partnerships for the Goals |

## Tagging Donations

Add `sdgCategories` to `POST /donations`:

```json
{
  "amount": "50",
  "donor": "GDONOR...",
  "recipient": "GRECIPIENT...",
  "sdgCategories": ["SDG3", "SDG4"]
}
```

Invalid codes return `400` with a list of valid codes.

## Endpoints

### GET /impact/sdg-breakdown

Returns donation totals and counts per SDG category.

**Query params:** `startDate`, `endDate` (ISO date strings, optional)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "breakdown": [
      { "code": "SDG1", "goal": 1, "title": "No Poverty", "totalAmount": 150.0, "count": 2 },
      ...
    ],
    "totalDonations": 5,
    "dateRange": { "startDate": "2026-01-01", "endDate": null }
  }
}
```

---

### GET /impact/report

Returns a structured impact report for the specified date range.

**Query params:** `startDate`, `endDate` (optional)

**Response (200):**
```json
{
  "success": true,
  "data": {
    "generatedAt": "2026-03-29T00:00:00.000Z",
    "dateRange": { "startDate": null, "endDate": null },
    "summary": {
      "totalDonations": 10,
      "totalAmount": 500.0,
      "taggedDonations": 7,
      "activeSdgCount": 4
    },
    "sdgBreakdown": [ ... ],
    "topSdgs": [ ... ]
  }
}
```

---

### POST /impact/report/export

Generate a downloadable CSV or PDF impact report.

**Body:**
```json
{ "format": "csv", "startDate": "2026-01-01", "endDate": "2026-03-31" }
```

- `format`: `"csv"` (default) or `"pdf"`
- `startDate`, `endDate`: optional ISO date strings

**CSV response** — `Content-Type: text/csv`, attachment filename `impact-report-<ts>.csv`

**PDF response** — `Content-Type: application/pdf`, attachment filename `impact-report-<ts>.pdf`

Returns `400` for unsupported format values.

## Validation

Invalid SDG codes in `sdgCategories` return:

```json
{
  "success": false,
  "error": {
    "message": "Invalid SDG category codes: SDG99, INVALID. Valid codes are SDG1–SDG17."
  }
}
```
