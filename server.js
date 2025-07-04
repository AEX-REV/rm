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

app.post("/upload", (req, res) => {
  const rawData = req.body;
  if (!rawData) return res.status(400).send("Ingen data modtaget");
  fs.writeFile(DATA_PATH, rawData, (err) => {
    if (err) {
      console.error("🚫 Fejl ved skrivning af fil:", err);
      return res.status(500).send("Fejl ved upload");
    }
    console.log("✅ Fil uploadet og gemt som current_snapshot.csv");
    res.send("Upload gennemført");
  });
});

function parseBookings(callback) {
  const bookings = [];
  fs.createReadStream(DATA_PATH)
    .pipe(csv())
    .on("data", (row) => {
      if (!row.FlightDate || !row.BookingDate) return;
      const flightDate = new Date(row.FlightDate);
      const bookingDate = new Date(row.BookingDate);
      const flightNumber = row.FlightNumber || row.str_Flight_Nmbrs;
      bookings.push({
        FlightDate: flightDate,
        BookingDate: bookingDate,
        FlightNumber: flightNumber,
        RBD: row.RBD || row.str_Fare_Class_Short,
        Price: parseFloat(row.TotalChargeAmount || "0"),
        Year: flightDate.getFullYear(),
        Weekday: flightDate.getDay(), // 0=Sunday..6
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

  // Upcoming flights in next 3 months
  const upcomingFlights = bookings.filter(
    (b) =>
      b.Year === thisYear &&
      b.FlightDate >= today &&
      b.FlightDate <= threeMonthsFromNow
  );

  // Build historical booking counts per DaysBefore for each FlightNumber + Weekday
  const groupedHistory = {};
  bookings.forEach((b) => {
    const key = `${b.FlightNumber}_${b.Weekday}`;
    if (!groupedHistory[key]) groupedHistory[key] = {};
    const d = b.DaysBefore;
    groupedHistory[key][d] = (groupedHistory[key][d] || 0) + 1;
  });

  // Count historical flights per key
  const historyCounts = {};
  for (const key in groupedHistory) {
    historyCounts[key] = new Set(
      bookings
        .filter((b) => `${b.FlightNumber}_${b.Weekday}` === key)
        .map((b) => b.FlightDate.toISOString().split("T")[0])
    ).size;
  }

  // Precompute average cumulative ratio per key
  const bookingStats = {};
  for (const key in groupedHistory) {
    const hist = groupedHistory[key];
    const flightCount = historyCounts[key] || 1;
    // Determine max days (e.g., 90)
    const maxDays = Math.max(...Object.keys(hist).map(Number), 90);
    // Compute cumulative counts
    let runningSum = 0;
    const avgCumulativeCounts = {};
    for (let d = maxDays; d >= 0; d--) {
      runningSum += hist[d] || 0;
      avgCumulativeCounts[d] = runningSum / flightCount;
    }
    // Compute average total bookings
    const totalBookings = Object.values(hist).reduce((sum, val) => sum + val, 0);
    const avgTotal = totalBookings / flightCount;
    // Compute cumulative ratio
    const avgCumRatio = {};
    for (const d in avgCumulativeCounts) {
      avgCumRatio[d] = avgCumulativeCounts[d] / (avgTotal || 1);
    }
    bookingStats[key] = { avgCumRatio };
  }

  // Forecast results
  const results = [];
  for (const flight of upcomingFlights) {
    const key = `${flight.FlightNumber}_${flight.Weekday}`;
    const daysToDeparture = Math.floor(
      (flight.FlightDate - today) / (1000 * 60 * 60 * 24)
    );
    const currentBookings = bookings.filter(
      (b) =>
        b.FlightNumber === flight.FlightNumber &&
        b.FlightDate.getTime() === flight.FlightDate.getTime()
    );
    const currentCount = currentBookings.length;

    const stats = bookingStats[key] || { avgCumRatio: {} };
    const fallbackRatio = 0.05;
    const ratio =
      stats.avgCumRatio[daysToDeparture] ||
      stats.avgCumRatio[30] ||
      fallbackRatio;
    const expectedPassengers = Math.round(currentCount / ratio);

    const avgPrice =
      currentBookings.reduce((sum, b) => sum + b.Price, 0) /
      (currentCount || 1);
    const expectedRevenue = Math.round(avgPrice * expectedPassengers);
    const loadFactor = Math.min(
      100,
      Math.round((expectedPassengers / SEAT_CAPACITY) * 100)
    );

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
        expectedPassengers > SEAT_CAPACITY
          ? `Overvej at åbne op til ${MAX_CAPACITY} pladser`
          : "",
      note: `Fremskrevet baseret på ${currentCount} pax og en historisk dækningsgrad på ${ratio.toFixed(2)}`,
    });
  }

  return results.sort(
    (a, b) => new Date(a.flightDate) - new Date(b.flightDate)
  );
}

app.get("/api/forecast", (req, res) => {
  parseBookings((bookings) => {
    try {
      const forecast = forecastBookings(bookings);
      res.json(forecast);
    } catch (err) {
      console.error("🚫 Fejl i forecast:", err);
      res.status(500).send("Fejl ved forecast");
    }
  });
});

app.listen(PORT, () => {
  console.log(`✅ RM server kører på http://localhost:${PORT}`);
});
