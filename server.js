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

// Sørg for at data-mappen findes
const dataDir = path.join(__dirname, "public", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Middleware
app.use(express.static("public"));
app.use(bodyParser.text({ type: "*/*", limit: "100mb" }));

// Ping test
app.get("/ping", (_, res) => res.send("pong"));

// Parser CSV til JS-objekter
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

// Forecast-logik
function forecastBookings(bookings) {
  const today = new Date();
  const thisYear = today.getFullYear();
  const threeMonthsFromNow = new Date();
  threeMonthsFromNow.setMonth(threeMonthsFromNow.getMonth() + 3);

const upcomingFlights = [];
const seen = new Set();

bookings.forEach((b) => {
  const dateKey = b.FlightDate.toISOString().split("T")[0];
  const key = `${b.FlightNumber}_${dateKey}`;
  if (
    b.Year === thisYear &&
    b.FlightDate >= today &&
    b.FlightDate <= threeMonthsFromNow &&
    !seen.has(key)
  ) {
    seen.add(key);
    upcomingFlights.push(b);
  }
});

  const results = [];
  const grouped = {};
  const historicalPatterns = {};

  bookings.forEach((b) => {
    const key = `${b.FlightNumber}_${b.Weekday}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(b);

    if (!historicalPatterns[key]) historicalPatterns[key] = {};
    const day = b.DaysBefore;
    if (!historicalPatterns[key][day]) historicalPatterns[key][day] = 0;
    historicalPatterns[key][day]++;
  });

  for (const flight of upcomingFlights) {
    const key = `${flight.FlightNumber}_${flight.Weekday}`;
    const currentBookings = bookings.filter(
      (b) =>
        b.FlightNumber === flight.FlightNumber &&
        b.FlightDate.getTime() === flight.FlightDate.getTime()
    );

    const daysToDeparture = Math.floor((flight.FlightDate - today) / (1000 * 60 * 60 * 24));
    const currentCount = currentBookings.length;

    const historicalSameFlight = grouped[key] || [];
    const pattern = historicalPatterns[key] || {};
    const totalPastFlights = new Set(
      historicalSameFlight.map((b) => b.FlightDate.toISOString().split("T")[0])
    ).size;

    let futureRatio = 0;
    for (let d = daysToDeparture + 1; d <= 90; d++) {
      futureRatio += (pattern[d] || 0);
    }
    const pastRatio = Object.values(pattern).reduce((a, b) => a + b, 0);
    const trend = pastRatio ? futureRatio / pastRatio : 0;

    const expectedPassengers = Math.round(currentCount + currentCount * trend);
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
      upgradeSuggestion:
        expectedPassengers > 60 ? "Overvej at åbne op til 64 pladser" : "",
      note: `Fremskrevet baseret på ${currentCount} pax og ${trend.toFixed(2)}x forventet kurve`,
    });
  }

  return results.sort((a, b) => new Date(a.flightDate) - new Date(b.flightDate));
}

// Forecast API
app.get("/api/forecast", (req, res) => {
  parseBookings((bookings) => {
    const forecast = forecastBookings(bookings);
    res.json(forecast);
  });
});

// Upload API
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

// Start server
app.listen(PORT, () => {
  console.log(`✅ RM server kører på http://localhost:${PORT}`);
});
