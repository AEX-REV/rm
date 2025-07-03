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
  const results = [];

  const grouped = {};
  bookings.forEach((b) => {
    const key = `${b.FlightNumber}_${b.Weekday}_${b.FlightDate.toISOString().split("T")[0]}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(b);
  });

  const threeMonthsFromNow = new Date();
  threeMonthsFromNow.setMonth(threeMonthsFromNow.getMonth() + 3);

  const upcomingFlights = bookings.filter(
    (b) =>
      b.Year === thisYear &&
      b.FlightDate >= today &&
      b.FlightDate <= threeMonthsFromNow
  );

  const byFlightAndWeekday = {};
  bookings.forEach((b) => {
    const key = `${b.FlightNumber}_${b.Weekday}_${b.Year}`;
    if (!byFlightAndWeekday[key]) byFlightAndWeekday[key] = [];
    byFlightAndWeekday[key].push(b);
  });

  for (const flight of upcomingFlights) {
    const keyThisYear = `${flight.FlightNumber}_${flight.Weekday}_${thisYear}`;
    const keyLastYear = `${flight.FlightNumber}_${flight.Weekday}_${thisYear - 1}`;
    const flightDateStr = flight.FlightDate.toISOString().split("T")[0];
    const daysToDeparture = Math.floor((flight.FlightDate - today) / (1000 * 60 * 60 * 24));

    const currentBookings = byFlightAndWeekday[keyThisYear]?.filter(
      (b) => b.FlightDate.getTime() === flight.FlightDate.getTime()
    ) || [];

    const lastYearSameDay = new Date(flight.FlightDate);
    lastYearSameDay.setFullYear(thisYear - 1);

    const sameWeekdayLastYear = bookings.filter(
      (b) =>
        b.FlightNumber === flight.FlightNumber &&
        b.FlightDate.getDay() === flight.Weekday &&
        Math.abs(b.FlightDate - lastYearSameDay) < 2 * 24 * 60 * 60 * 1000 &&
        b.Year === thisYear - 1
    );

    const fallback = byFlightAndWeekday[keyLastYear] || [];

    const base = sameWeekdayLastYear.length ? sameWeekdayLastYear : fallback;

    const referencePax = base.length || 1;
    const currentPax = currentBookings.length;
    const trendRatio = currentPax / referencePax;

    const avgPrice = base.reduce((sum, b) => sum + b.Price, 0) / base.length || 0;
    const expectedPassengers = Math.round(referencePax * trendRatio);
    const expectedRevenue = Math.round(avgPrice * expectedPassengers);
    const loadFactor = Math.min(100, Math.round((expectedPassengers / SEAT_CAPACITY) * 100));

    results.push({
      flight: flight.FlightNumber,
      flightDate: flightDateStr,
      weekday: flight.Weekday,
      daysToDeparture,
      currentBookings: currentPax,
      expectedPassengers,
      expectedRevenue,
      loadFactor: `${loadFactor}%`,
      upgradeSuggestion:
        expectedPassengers > 60 ? "Overvej at åbne op til 64 pladser" : "",
      note: `Baseret på ${referencePax} pax sidste år og ${trendRatio.toFixed(2)}x bookingtrend`,
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
