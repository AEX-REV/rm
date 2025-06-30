// server.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 8080;
const DATA_PATH = path.join(__dirname, 'data', 'current_snapshot.csv');

app.use(express.static('public'));
app.use(bodyParser.text({ type: '*/*' }));

app.get('/ping', (req, res) => {
  res.send('pong');
});

function parseBookings(callback) {
  const bookings = [];

  fs.createReadStream(DATA_PATH)
    .pipe(csv())
    .on('data', (row) => {
      if (!row.FlightDate || !row.BookingDate) return;

      const flightDate = new Date(row.FlightDate.split('T')[0]);
      const bookingDate = new Date(row.BookingDate.split('T')[0]);

      bookings.push({
        FlightDate: flightDate,
        BookingDate: bookingDate,
        RBD: row.RBD || row.str_Fare_Class_Short?.charAt(0) || '',
        FlightNumber: row.FlightNumber || row.str_Flight_Nmbrs || '',
        Price: parseFloat(row.TotalChargeAmount || '0'),
        Year: flightDate.getFullYear(),
      });
    })
    .on('end', () => {
      callback(bookings);
    });
}

function generateSuggestions(bookings, thresholdPercent = 20) {
  const suggestions = [];
  const today = new Date();
  const thisYear = today.getFullYear();

  const grouped = {};

  bookings.forEach(b => {
    if (!b.FlightNumber || isNaN(b.FlightDate)) return;

    const weekday = b.FlightDate.getDay();
    const key = `${b.FlightNumber}_${weekday}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(b);
  });

  for (const [key, flights] of Object.entries(grouped)) {
    const [flightNumber, weekday] = key.split('_');
    const currentYear = flights.filter(f => f.Year === thisYear);
    const previousYear = flights.filter(f => f.Year === thisYear - 1);

    if (currentYear.length && previousYear.length) {
      const refFlight = currentYear[0];
      const daysToDeparture = Math.floor((refFlight.FlightDate - today) / (1000 * 60 * 60 * 24));

      if (daysToDeparture > 10) {
        const ratio = currentYear.length / previousYear.length;
        if (ratio > 1 + thresholdPercent / 100) {
          suggestions.push({
            flight: flightNumber,
            weekday: parseInt(weekday),
            bookingsThisYear: currentYear.length,
            bookingsLastYear: previousYear.length,
            daysToDeparture,
            recommendation: `Hæv prisen – ${currentYear.length} bookinger i år vs ${previousYear.length} sidste år.`,
          });
        }
      }
    }
  }

  return suggestions;
}

function forecastBookings(bookings) {
  const forecasts = [];
  const today = new Date();
  const thisYear = today.getFullYear();
  const grouped = {};

  bookings.forEach(b => {
    const flightNumber = b.FlightNumber;
    const weekday = b.FlightDate.getDay();
    const daysBefore = Math.floor((b.FlightDate - b.BookingDate) / (1000 * 60 * 60 * 24));
    const key = `${flightNumber}_${weekday}`;

    if (!grouped[key]) grouped[key] = [];
    grouped[key].push({ ...b, daysBefore });
  });

  for (const [key, entries] of Object.entries(grouped)) {
    const [flightNumber, weekday] = key.split('_');
    const current = entries.filter(e => e.Year === thisYear);
    const past = entries.filter(e => e.Year === thisYear - 1);

    if (!current.length || !past.length) continue;

    const sample = current[0];
    const daysToDeparture = Math.floor((sample.FlightDate - today) / (1000 * 60 * 60 * 24));
    const comparable = past.filter(p => p.daysBefore <= daysToDeparture + 1 && p.daysBefore >= daysToDeparture - 1);

    const total = comparable.length;
    const sumPrice = comparable.reduce((acc, c) => acc + c.Price, 0);

    const avgPassengers = total / (daysToDeparture === 0 ? 1 : 1);
    const avgRevenue = sumPrice / (daysToDeparture === 0 ? 1 : 1);

    forecasts.push({
      flight: flightNumber,
      weekday: parseInt(weekday),
      daysToDeparture,
      currentBookings: current.length,
      expectedPassengers: Math.round(avgPassengers),
      expectedRevenue: Math.round(avgRevenue),
      note: `Forventer ${Math.round(avgPassengers)} pax og ${Math.round(avgRevenue)} DKK hvis tendens fortsætter.`
    });
  }

  return forecasts;
}

// API endpoints
app.get('/api/suggestions', (req, res) => {
  const threshold = parseFloat(req.query.threshold) || 20;
  parseBookings((bookings) => {
    const suggestions = generateSuggestions(bookings, threshold);
    res.json(suggestions);
  });
});

app.get('/api/forecast', (req, res) => {
  parseBookings((bookings) => {
    const forecast = forecastBookings(bookings);
    res.json(forecast);
  });
});

app.post('/upload', (req, res) => {
  const rawData = req.body;
  if (!rawData || typeof rawData !== 'string') {
    return res.status(400).send('Ugyldig data');
  }

  fs.writeFile(DATA_PATH, rawData, (err) => {
    if (err) {
      console.error('🚫 Fejl ved skrivning af fil:', err);
      return res.status(500).send('Fejl ved upload');
    }
    console.log('✅ Fil uploadet og gemt som current_snapshot.csv');
    res.send('Upload gennemført');
  });
});

app.listen(PORT, () => {
  console.log(`✅ RM server kører på http://localhost:${PORT}`);
});
