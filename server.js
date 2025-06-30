// server.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 8080;

// CSV-fil skal ligge i public/data så browseren kan hente den
const DATA_PATH = path.join(__dirname, 'public', 'data', 'current_snapshot.csv');
const dataDir = path.join(__dirname, 'public', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Middleware
app.use(express.static('public'));
app.use(bodyParser.text({ type: '*/*', limit: '100mb' }));

// Health check
app.get('/ping', (req, res) => {
  res.send('pong');
});

// Parse CSV bookings
function parseBookings(callback) {
  const bookings = [];

  if (!fs.existsSync(DATA_PATH)) {
    console.warn('⚠️ Ingen CSV-fil fundet endnu');
    return callback(bookings);
  }

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

// Forecast endpoint med 3 måneders horisont og forbedret metode
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

      const sameWeekdayLastYear = allLastYear.filter(b => {
        const dateLastYear = new Date(flight.FlightDate);
        dateLastYear.setFullYear(lastYear);
        return (
          b.FlightNumber === flightNumber &&
          b.FlightDate.getDay() === weekday &&
          Math.abs((b.FlightDate - dateLastYear) / (1000 * 60 * 60 * 24)) <= 2
        );
      });

      const paxLastYear = sameWeekdayLastYear.length;
      const revenueLastYear = sameWeekdayLastYear.reduce((sum, b) => sum + b.Price, 0);

      const expectedPassengers = paxLastYear;
      const expectedRevenue = revenueLastYear;
      const loadFactor = (expectedPassengers / 50) * 100;

      const shouldUpgradeCapacity = expectedPassengers > 60;

      forecasts.push({
        flight: flightNumber,
        flightDate: flight.FlightDate.toISOString().split('T')[0],
        weekday,
        daysToDeparture,
        currentBookings: futureFlights.filter(f => f.FlightNumber === flightNumber && f.FlightDate.getTime() === flight.FlightDate.getTime()).length,
        expectedPassengers,
        expectedRevenue: Math.round(expectedRevenue),
        loadFactor: Math.round(loadFactor) + '%',
        upgradeSuggestion: shouldUpgradeCapacity ? 'Overvej at åbne op til 64 pladser' : '',
        note: `Baseret på ${expectedPassengers} pax samme ugedag sidste år`
      });
    });

    res.json(forecasts);
  });
});

// API til forslag
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
