const express = require('express');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 8080;

const DATA_FILE = path.join(__dirname, 'data', 'current_snapshot.csv');
app.use(express.static('public'));
app.use(bodyParser.text({ type: 'text/plain' }));

function parseBookings(callback) {
  const bookings = [];

  if (!fs.existsSync(DATA_FILE)) {
    console.log("⚠️ CSV ikke fundet");
    return callback([]);
  }

  fs.createReadStream(DATA_FILE)
    .pipe(csv())
    .on('data', (row) => {
      bookings.push({
        BookingDate: new Date(row.BookingDate),
        FlightDate: new Date(row.FlightDate),
        FlightNumber: row.str_Flight_Nmbrs,
        RBD: row.str_Fare_Class_Short ? row.str_Fare_Class_Short.charAt(0) : '',
        Price: parseFloat(row.TotalChargeAmount)
      });
    })
    .on('end', () => {
      callback(bookings);
    });
}

function generateSuggestions(bookings, thresholdPercent = 20) {
  const suggestions = [];
  const grouped = {};

  const today = new Date();
  const thisYear = today.getFullYear();
  const lastYear = thisYear - 1;

  function getComparableDate(date) {
    const d = new Date(date);
    const weekday = d.getDay();
    const target = new Date(d);
    target.setFullYear(lastYear);
    while (target.getDay() !== weekday) {
      target.setDate(target.getDate() + 1);
    }
    return target;
  }

  bookings.forEach((b) => {
    const key = `${b.FlightNumber}_${b.FlightDate.toISOString().split('T')[0]}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(b);
  });

  Object.entries(grouped).forEach(([key, group]) => {
    const [flightNumber, dateStr] = key.split('_');
    const flightDate = new Date(dateStr);
    const daysToFlight = Math.floor((flightDate - today) / (1000 * 60 * 60 * 24));
    const thisYearData = group.filter(b => b.FlightDate.getFullYear() === thisYear);
    const comparisonDate = getComparableDate(flightDate);
    const lastYearData = bookings.filter(b =>
      b.FlightDate.toDateString() === comparisonDate.toDateString() &&
      b.FlightNumber === flightNumber
    );

    if (thisYearData.length && lastYearData.length) {
      const thisCount = thisYearData.length;
      const lastCount = lastYearData.length;

      if (lastCount > 0 && thisCount > lastCount * (1 + thresholdPercent / 100) && daysToFlight > 10) {
        suggestions.push({
          flight: `${flightNumber} den ${flightDate.toISOString().split('T')[0]}`,
          bookingsThisYear: thisCount,
          bookingsLastYear: lastCount,
          daysToFlight,
          recommendation: `📈 Hæv pris – ${thisCount} bookinger i år vs ${lastCount} sidste år.`
        });
      }
    }
  });

  return suggestions;
}

app.get('/api/suggestions', (req, res) => {
  const threshold = parseFloat(req.query.threshold) || 20;
  parseBookings((bookings) => {
    const suggestions = generateSuggestions(bookings, threshold);
    res.json(suggestions);
  });
});

app.post('/api/upload-csv', (req, res) => {
  const content = req.body;
  if (!content) return res.status(400).send("Ingen CSV modtaget");

  fs.writeFile(DATA_FILE, content, (err) => {
    if (err) {
      console.error("🚫 Fejl ved gem af CSV:", err);
      return res.status(500).send("Fejl ved skrivning af fil");
    }
    console.log("✅ Ny CSV gemt via Make");
    res.send("CSV gemt");
  });
});

app.listen(PORT, () => {
  console.log(`✅ RM server kører på http://localhost:${PORT}`);
});
