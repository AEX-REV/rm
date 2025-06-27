const express = require('express');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');

const app = express();
const PORT = process.env.PORT || 3000;

const CSV_PATH = path.join(__dirname, 'data', 'current_snapshot.csv');

app.use(express.static('public'));

// Hjælpefunktion til datoformat
function normalizeDate(dateStr) {
  return new Date(dateStr.split('T')[0]);
}

// Udtræk bookinger fra CSV
function parseBookings(callback) {
  const bookings = [];
  fs.createReadStream(CSV_PATH)
    .pipe(csv())
    .on('data', (row) => {
      bookings.push({
        BookingDate: normalizeDate(row.BookingDate),
        FlightDate: normalizeDate(row.FlightDate),
        FlightNumber: row.str_Flight_Nmbrs,
        RBD: row.str_Fare_Class_Short?.charAt(0),
        Price: parseFloat(row.TotalChargeAmount)
      });
    })
    .on('end', () => {
      callback(bookings);
    });
}

// Generer forslag baseret på trends
function generateSuggestions(bookings, threshold = 20) {
  const suggestions = [];
  const today = new Date();
  const grouped = {};

  bookings.forEach((b) => {
    const flightKey = `${b.FlightNumber}_${b.FlightDate.toISOString().slice(0, 10)}`;
    if (!grouped[flightKey]) grouped[flightKey] = [];
    grouped[flightKey].push(b);
  });

  Object.entries(grouped).forEach(([key, entries]) => {
    const [flightNumber, dateStr] = key.split('_');
    const thisYearDate = new Date(dateStr);
    const lastYearDate = new Date(thisYearDate);
    lastYearDate.setFullYear(thisYearDate.getFullYear() - 1);

    const thisYear = entries.filter(e => e.FlightDate.getFullYear() === thisYearDate.getFullYear());
    const lastYear = bookings.filter(e =>
      e.FlightNumber === flightNumber &&
      e.FlightDate.toDateString() === lastYearDate.toDateString()
    );

    if (thisYear.length > lastYear.length * (1 + threshold / 100)) {
      const daysToDeparture = Math.ceil((thisYearDate - today) / (1000 * 60 * 60 * 24));
      if (daysToDeparture > 10) {
        suggestions.push({
          flightNumber,
          flightDate: thisYearDate.toISOString().slice(0, 10),
          bookingsThisYear: thisYear.length,
          bookingsLastYear: lastYear.length,
          daysToDeparture,
          recommendation: `Hæv pris – ${thisYear.length} booket i år vs ${lastYear.length} sidste år`
        });
      }
    }
  });

  return suggestions;
}

// API endpoint
app.get('/api/suggestions', (req, res) => {
  const threshold = parseFloat(req.query.threshold) || 20;
  parseBookings((bookings) => {
    const suggestions = generateSuggestions(bookings, threshold);
    res.json(suggestions);
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ RM server kører på http://localhost:${PORT}`);
});
