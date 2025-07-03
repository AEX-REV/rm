
document.addEventListener("DOMContentLoaded", async () => {
  const root = document.getElementById("root");

  const response = await fetch("/api/forecast");
  const data = await response.json();

  let filterText = "";
  let sortField = "flightDate";
  let sortAsc = true;

  const renderTable = () => {
    let filtered = data.filter(item =>
      item.flight.toLowerCase().includes(filterText.toLowerCase()) ||
      item.flightDate.includes(filterText)
    );

    filtered.sort((a, b) => {
      const valA = a[sortField];
      const valB = b[sortField];
      if (typeof valA === "string") {
        return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortAsc ? valA - valB : valB - valA;
    });

    const headers = [
      ["Flight", "flight"],
      ["Date", "flightDate"],
      ["Weekday", "weekday"],
      ["Days to Departure", "daysToDeparture"],
      ["Current Bookings", "currentBookings"],
      ["Expected Pax", "expectedPassengers"],
      ["Expected Revenue", "expectedRevenue"],
      ["Load Factor", "loadFactor"],
      ["Upgrade", "upgradeSuggestion"],
      ["Note", "note"]
    ];

    root.innerHTML = `
      <h1>Flight Forecast</h1>
      <input type="text" placeholder="Søg flight eller dato" value="${filterText}" />
      <table>
        <thead>
          <tr>
            ${headers.map(([label, field]) => `<th data-field="${field}">${label}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${filtered.map(row => `
            <tr>
              ${headers.map(([, field]) => `<td>${row[field] || ""}</td>`).join("")}
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;

    root.querySelector("input").addEventListener("input", e => {
      filterText = e.target.value;
      renderTable();
    });

    root.querySelectorAll("th").forEach(th => {
      th.addEventListener("click", () => {
        const field = th.getAttribute("data-field");
        if (sortField === field) {
          sortAsc = !sortAsc;
        } else {
          sortField = field;
          sortAsc = true;
        }
        renderTable();
      });
    });
  };

  renderTable();
});
