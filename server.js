// server.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 8080;

const DATA_PATH = path.join(__dirname, 'public', 'data', 'current_snapshot.csv');
const dataDir = path.join(__dirname, 'public', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

app.use(express.static('public'));
app.use(bodyParser.text({ type: '*/*', limit: '100mb' }));

app.get('/ping', (req, res) => {
  res.send('pong');
});

function getISOWeek(date) {
  const d = new Date(date.getTime());
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function parseBookings(callback) {
  const bookings = [];

  fs.createReadStream(DATA_PATH)
    .pipe(csv())
    .on('data', (row) => {
      if (!row.FlightDate || !row.BookingDate) return;

      bookings.push({
        FlightDate: new Date(row.FlightDate.split('T')[0]),
        BookingDate: new Date(row.BookingDate.split('T')[0]),
        RBD: row.RBD || row.str_Fare_Class_Short?.charAt(0) || '',
        FlightNumber: row.FlightNumber || row.str_Flight_Nmbrs || '',
        Price: parseFloat(row.TotalChargeAmount || '0'),
        Year: new Date(row.FlightDate).getFullYear(),
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

app.get('/api/forecast', (req, res) => {
  parseBookings((bookings) => {
    const today = new Date();
    const threeMonthsAhead = new Date();
    threeMonthsAhead.setMonth(threeMonthsAhead.getMonth() + 3);
    const thisYear = today.getFullYear();
    const lastYear = thisYear - 1;

    const futureFlights = bookings.filter(b =>
      b.FlightDate >= today &&
      b.FlightDate <= threeMonthsAhead &&
      b.Year === thisYear
    );

    const allLastYear = bookings.filter(b => b.Year === lastYear);

    const forecasts = [];

    futureFlights.forEach(flight => {
      const flightNumber = flight.FlightNumber;
      const weekday = flight.FlightDate.getDay();
      const daysToDeparture = Math.floor((flight.FlightDate - today) / (1000 * 60 * 60 * 24));

      const oneYearAgo = new Date(flight.FlightDate);
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      const targetWeek = getISOWeek(oneYearAgo);

      const similarLastYear = allLastYear.filter(b =>
        b.FlightNumber === flightNumber &&
        getISOWeek(b.FlightDate) === targetWeek &&
        b.FlightDate.getDay() === weekday
      );

      const similarCount = similarLastYear.length;
      const similarRevenue = similarLastYear.reduce((acc, b) => acc + b.Price, 0);

      forecasts.push({
        flight: flightNumber,
        flightDate: flight.FlightDate.toISOString().split('T')[0],
        weekday,
        daysToDeparture,
        currentBookings: futureFlights.filter(f => f.FlightNumber === flightNumber && f.FlightDate.getTime() === flight.FlightDate.getTime()).length,
        expectedPassengers: similarCount,
        expectedRevenue: Math.round(similarRevenue),
        note: `Baseret på ${similarCount} pax sidste år og lignende afgange samme ugedag og uge.`
      });
    });

    res.json(forecasts);
  });
});

app.get('/api/suggestions', (req, res) => {
  const threshold = parseFloat(req.query.threshold) || 20;
  parseBookings((bookings) => {
    const suggestions = generateSuggestions(bookings, threshold);
    res.json(suggestions);
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
