
async function loadForecast() {
  const res = await fetch('/api/forecast');
  const data = await res.json();

  const container = document.getElementById('forecast');
  const table = document.createElement('table');

  table.innerHTML = `
    <thead>
      <tr>
        <th>Flight</th>
        <th>Date</th>
        <th>Weekday</th>
        <th>Days to Departure</th>
        <th>Current Bookings</th>
        <th>Expected Pax</th>
        <th>Expected Revenue</th>
        <th>Load Factor</th>
        <th>Upgrade</th>
        <th>Note</th>
      </tr>
    </thead>
    <tbody>
      ${data.map(f => `
        <tr>
          <td>${f.flight}</td>
          <td>${f.flightDate}</td>
          <td>${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][f.weekday]}</td>
          <td>${f.daysToDeparture}</td>
          <td>${f.currentBookings}</td>
          <td>${f.expectedPassengers}</td>
          <td>${f.expectedRevenue}</td>
          <td>${f.loadFactor}</td>
          <td>${f.upgradeSuggestion}</td>
          <td>${f.note}</td>
        </tr>`).join('')}
    </tbody>
  `;

  container.appendChild(table);
}

loadForecast();
