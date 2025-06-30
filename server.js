// server.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 8080;
const DATA_PATH = path.join(__dirname, 'public', 'data', 'current_snapshot.csv');

// Middleware
app.use(express.static('public'));
app.use(bodyParser.text({ type: '*/*' }));

// Health check
app.get('/ping', (req, res) => {
  res.send('pong');
});

// Parse CSV bookings
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

// Generer forslag
function generateSuggestions(bookings, thresholdPercent = 20) {
  const suggestions = [];
  const today = new Date();
  const thisYear = today.getFullYear();

  // Grupper efter flight number og ugedag
  const grouped = {};

  bookings.forEach(b => {
    if (!b.FlightNumber || isNaN(b.FlightDate)) return;

    const weekday = b.FlightDate.getDay(); // 0 = søndag
    const key = `${b.FlightNumber}_${weekday}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(b);
  });

  for (const [key, flights] of Object.entries(grouped)) {
    const [flightNumber, weekday] = key.split('_');
    const currentYear = flights.filter(f => f.Year === thisYear);
    const previousYear = flights.filter(f => f.Year === thisYear - 1);

    if (currentYear.length && previousYear.length) {
      // Brug første flight i år som reference
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

// GET suggestions endpoint
app.get('/api/suggestions', (req, res) => {
  const threshold = parseFloat(req.query.threshold) || 20;
  parseBookings((bookings) => {
    const suggestions = generateSuggestions(bookings, threshold);
    res.json(suggestions);
  });
});

// POST upload endpoint
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

// Start server
app.listen(PORT, () => {
  console.log(`✅ RM server kører på http://localhost:${PORT}`);
});
