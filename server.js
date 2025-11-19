import express from "express";
import { google } from "googleapis";

const app = express();
app.use(express.json());

// =====================================================
// 1. GOOGLE AUTH – chuẩn Enterprise
// =====================================================
async function getSheetsClient() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);

  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  return google.sheets({ version: "v4", auth });
}

// Clean row: nếu có dấu ' do kết quả từ các công thức → bỏ luôn
function cleanRow(row) {
  return row.map(v => {
    if (typeof v === "string" && v.startsWith("'")) {
      return v.slice(1);
    }
    return v;
  });
}

// =====================================================
// 2. Enterprise Import API
// =====================================================
app.post("/import-data", async (req, res) => {
  try {
    const {
      sourceFileId,
      sourceSheet,
      sourceRange,
      destFileId,
      destSheet,
      startDate,
      endDate
    } = req.body;

    const sheets = await getSheetsClient();

    // -----------------------------------------------------
    // STEP 1 — ĐỌC DỮ LIỆU NGUỒN (RAW → không còn lỗi dấu ')
    // -----------------------------------------------------
    const read = await sheets.spreadsheets.values.get({
      spreadsheetId: sourceFileId,
      range: `${sourceSheet}!${sourceRange}`,
      valueRenderOption: "UNFORMATTED_VALUE",   // 🔥 lấy RAW value từ Sheet (không display)
      dateTimeRenderOption: "FORMATTED_STRING"  // giữ format ngày
    });

    const rows = read.data.values || [];

    const sd = new Date(startDate);
    const ed = new Date(endDate);

    // -----------------------------------------------------
    // STEP 2 — FILTER theo ngày (cột I)
    // -----------------------------------------------------
    const filtered = rows.filter(r => {
      const d = r[8]; // cột I
      if (!d) return false;

      const dateObj = new Date(d);
      return dateObj >= sd && dateObj <= ed;
    });

    if (filtered.length === 0) {
      return res.json({
        message: "Không tìm thấy dòng phù hợp",
        imported: 0
      });
    }

    // -----------------------------------------------------
    // STEP 2.5 — CLEAN dữ liệu (nếu vẫn còn dấu ' do input)
    // -----------------------------------------------------
    const cleaned = filtered.map(r => cleanRow(r));

    // -----------------------------------------------------
    // STEP 3 — CLEAR dữ liệu cũ
    // -----------------------------------------------------
    await sheets.spreadsheets.values.clear({
      spreadsheetId: destFileId,
      range: `${destSheet}!A2:Z`
    });

    // -----------------------------------------------------
    // STEP 4 — GHI DỮ LIỆU MỚI (RAW → giữ nguyên giá trị)
    // -----------------------------------------------------
    await sheets.spreadsheets.values.update({
      spreadsheetId: destFileId,
      range: `${destSheet}!A2`,
      valueInputOption: "RAW",
      requestBody: {
        values: cleaned
      }
    });

    res.json({
      message: "Import thành công",
      imported: cleaned.length
    });

  } catch (err) {
    console.error("IMPORT ERROR:", err.response?.data || err.message);
    res.status(500).json({
      error: err.response?.data || err.message
    });
  }
});

// =====================================================
// 3. Healthcheck
// =====================================================
app.get("/", (req, res) => {
  res.send("GHN Importer Enterprise API is running.");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running on Railway (Enterprise mode)...");
});
