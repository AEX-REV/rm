// server.js
const express = require("express");
const path = require("path");
const fs = require("fs");
const csv = require("csv-parser");
const bodyParser = require("body-parser");

const app = express();
const PORT = process.env.PORT || 8080;
const DATA_PATH = path.join(__dirname, "public", "data", "current_snapshot.csv");
const SEAT_CAPACITY = 50;
const MAX_CAPACITY = 64;

const dataDir = path.join(__dirname, "public", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

app.use(express.static("public"));
app.use(bodyParser.text({ type: "*/*", limit: "100mb" }));

app.get("/ping", (_, res) => res.send("pong"));

function parseBookings(callback) {
  const bookings = [];
  fs.createReadStream(DATA_PATH)
    .pipe(csv())
    .on("data", (row) => {
      if (!row.FlightDate || !row.BookingDate) return;

      const flightDate = new Date(row.FlightDate);
      const bookingDate = new Date(row.BookingDate);
      const year = flightDate.getFullYear();

      bookings.push({
        FlightDate: flightDate,
        BookingDate: bookingDate,
        FlightNumber: row.FlightNumber || row.str_Flight_Nmbrs,
        RBD: row.RBD || row.str_Fare_Class_Short,
        Price: parseFloat(row.TotalChargeAmount || "0"),
        Year: year,
        Weekday: flightDate.getDay(),
        DaysBefore: Math.floor((flightDate - bookingDate) / (1000 * 60 * 60 * 24)),
      });
    })
    .on("end", () => callback(bookings));
}

function forecastBookings(bookings) {
  const today = new Date();
  const thisYear = today.getFullYear();
  const threeMonthsFromNow = new Date();
  threeMonthsFromNow.setMonth(threeMonthsFromNow.getMonth() + 3);

  const upcomingFlights = bookings.filter(
    (b) =>
      b.Year === thisYear &&
      b.FlightDate >= today &&
      b.FlightDate <= threeMonthsFromNow
  );

  const results = [];
  const groupedHistory = {};

  // Opbyg historisk mønster: antal bookinger per dag før afgang for hver FlightNumber + Weekday
  bookings.forEach((b) => {
    const key = `${b.FlightNumber}_${b.Weekday}`;
    if (!groupedHistory[key]) groupedHistory[key] = {};
    const d = b.DaysBefore;
    if (!groupedHistory[key][d]) groupedHistory[key][d] = 0;
    groupedHistory[key][d]++;
  });

  // Tæl hvor mange historiske afgange der findes per nøgle
  const historyCounts = {};
  for (const key in groupedHistory) {
    const allDays = Object.keys(groupedHistory[key]);
    historyCounts[key] = new Set(
      bookings.filter(b => `${b.FlightNumber}_${b.Weekday}` === key)
              .map(b => b.FlightDate.toISOString().split("T")[0])
    ).size;
  }

  for (const flight of upcomingFlights) {
    const key = `${flight.FlightNumber}_${flight.Weekday}`;
    const daysToDeparture = Math.floor((flight.FlightDate - today) / (1000 * 60 * 60 * 24));
    const currentBookings = bookings.filter(
      (b) => b.FlightNumber === flight.FlightNumber &&
             b.FlightDate.getTime() === flight.FlightDate.getTime()
    );
    const currentCount = currentBookings.length;

    const history = groupedHistory[key] || {};
    const totalFlights = historyCounts[key] || 1;

    let cumulative = 0;
    for (let d = 90; d >= daysToDeparture; d--) {
      cumulative += history[d] || 0;
    }
    const cumulativeRatio = cumulative / (totalFlights || 1);
    const totalRatio = Object.values(history).reduce((a, b) => a + b, 0) / (totalFlights || 1);
    const factor = totalRatio > 0 ? cumulativeRatio / totalRatio : 1;
    const expectedPassengers = Math.round(currentCount / (factor || 1));

    const avgPrice = currentBookings.reduce((sum, b) => sum + b.Price, 0) / (currentCount || 1);
    const expectedRevenue = Math.round(avgPrice * expectedPassengers);
    const loadFactor = Math.min(100, Math.round((expectedPassengers / SEAT_CAPACITY) * 100));

    results.push({
      flight: flight.FlightNumber,
      flightDate: flight.FlightDate.toISOString().split("T")[0],
      weekday: flight.Weekday,
      daysToDeparture,
      currentBookings: currentCount,
      expectedPassengers,
      expectedRevenue,
      loadFactor: `${loadFactor}%`,
      upgradeSuggestion: expectedPassengers > 60 ? "Overvej at åbne op til 64 pladser" : "",
      note: `Fremskrevet baseret på ${currentCount} pax og ${factor.toFixed(2)}x kurve fra historik`,
    });
  }

  return results.sort((a, b) => new Date(a.flightDate) - new Date(b.flightDate));
}

app.get("/api/forecast", (req, res) => {
  parseBookings((bookings) => {
    const forecast = forecastBookings(bookings);
    res.json(forecast);
  });
});

app.post("/upload", (req, res) => {
  const rawData = req.body;
  if (!rawData || typeof rawData !== "string") {
    return res.status(400).send("Ugyldig data");
  }

  fs.writeFile(DATA_PATH, rawData, (err) => {
    if (err) {
      console.error("🚫 Fejl ved skrivning af fil:", err);
      return res.status(500).send("Fejl ved upload");
    }
    console.log("✅ Fil uploadet og gemt som current_snapshot.csv");
    res.send("Upload gennemført");
  });
});

app.listen(PORT, () => {
  console.log(`✅ RM server kører på http://localhost:${PORT}`);
});
