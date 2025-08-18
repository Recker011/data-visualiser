document.addEventListener('DOMContentLoaded', () => {
    const timeZone = 'Australia/Melbourne';

    // Utility Functions
    const parseMoney = (str) => {
        if (typeof str !== 'string' || str.toLowerCase() === 'n/a') return 0;
        const match = str.match(/(\d+(\.\d+)?)/);
        return match ? parseFloat(match[1]) : 0;
    };

    const parsePaidHours = (str) => {
        if (typeof str !== 'string') return null;
        const matches = str.matchAll(/(\d+(\.\d+)?)\s*H/gi);
        let totalHours = 0;
        for (const match of matches) {
            totalHours += parseFloat(match[1]);
        }
        return totalHours > 0 ? totalHours : null;
    };

    const formatAUD = (n) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n);
    const formatDateAU = (d) => new Intl.DateTimeFormat('en-AU', { day: '2-digit', month: 'short', year: 'numeric', timeZone }).format(d);

    const getMonday = (d) => {
        const date = new Date(d.valueOf());
        const day = date.getUTCDay();
        const diff = date.getUTCDate() - day + (day === 0 ? -6 : 1);
        return new Date(date.setUTCDate(diff));
    };

    // Diagnostics banner helpers
    const ensureBanner = () => {
        let banner = document.getElementById('error-banner');
        const headerEl = document.querySelector('header');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'error-banner';
            banner.style.display = 'none';
            banner.style.padding = '8px';
            banner.style.margin = '8px 0';
            banner.style.background = '#fff3cd';
            banner.style.color = '#664d03';
            banner.style.border = '1px solid #ffe69c';
            banner.style.borderRadius = '8px';
            headerEl?.appendChild(banner);
        }
        return banner;
    };
    const showWarn = (msg) => {
        const banner = ensureBanner();
        banner.textContent = msg;
        banner.style.display = 'block';
    };

    // CSV parsing diagnostics
    const parseInfo = { count: 0, delimiter: 'auto-detected' };

    const toCanonical = (key) => {
        if (typeof key !== 'string') return key;
        const k = key.replace(/^\uFEFF/, '').trim();
        const norm = k.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
        const map = {
            'date': 'Date',
            'booking name': 'Booking Name',
            'booking': 'Booking Name',
            'name': 'Booking Name',
            'employees': 'Employees',
            'employee s': 'Employees',
            'staff': 'Employees',
            'cost': 'Cost',
            'amount': 'Cost',
            'value': 'Cost',
            'hours paid out': 'Hours Paid Out',
            'hours': 'Hours Paid Out',
            'paid hours': 'Hours Paid Out'
        };
        return map[norm] || k;
    };

    const mapHeadersOnRows = (rows) => rows.map(r => {
        const out = {};
        for (const [k, v] of Object.entries(r)) {
            out[toCanonical(k)] = v;
        }
        return out;
    });

    const loadCSV = async () => {
        ensureBanner();
        try {
            const res = await fetch('refined_jobs.csv?cachebust=' + Date.now(), { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            let txt = await res.text();
            txt = txt.replace(/^\uFEFF/, '');

            let results = Papa.parse(txt, {
                header: true,
                skipEmptyLines: true,
                dynamicTyping: false,
                delimitersToGuess: [",", "\t", ";", "|"]
            });

            let rows = results.data;
            parseInfo.delimiter = results?.meta?.delimiter || parseInfo.delimiter;

            if (rows.length === 0) {
                const firstLine = txt.split(/\r?\n/)[0] || '';
                if (firstLine.includes('\t')) {
                    results = Papa.parse(txt, { header: true, skipEmptyLines: true, delimiter: "\t" });
                    rows = results.data;
                    parseInfo.delimiter = '\\t';
                }
            }

            if (rows.length === 0) {
                // headerless fallback: build objects using first non-empty row as keys
                const res2 = Papa.parse(txt, { header: false, skipEmptyLines: true });
                const arrays = res2.data;
                let headerRow = arrays.find(r => Array.isArray(r) && r.some(c => String(c || '').trim().length > 0)) || [];
                headerRow = headerRow.map(h => String(h || '').trim());
                const body = arrays.slice(arrays.indexOf(headerRow) + 1);
                rows = body
                    .filter(r => Array.isArray(r) && r.some(c => String(c || '').trim().length > 0))
                    .map(r => {
                        const obj = {};
                        headerRow.forEach((h, i) => { obj[h] = r[i]; });
                        return obj;
                    });
                parseInfo.delimiter = res2?.meta?.delimiter || parseInfo.delimiter;
                results = res2;
            }

            rows = mapHeadersOnRows(rows);
            parseInfo.count = rows.length;

            console.log('CSV rows parsed:', parseInfo.count);
            if (rows[0]) console.log('First row keys:', Object.keys(rows[0]));

            if (results?.errors && results.errors.length) {
                console.warn('Papa errors:', results.errors);
                showWarn('Some rows had parse warnings; check console for details.');
            }

            if (rows.length === 0) {
                showWarn('No rows parsed from refined_jobs.csv. Check header names and delimiter. Expected headers: Date, Booking Name, Employees, Cost, Hours Paid Out');
                return null;
            }

            // Display quick diagnostics under header before rendering
            const diag = document.getElementById('last-updated');
            if (diag) {
                diag.textContent = `Loaded ${parseInfo.count} rows · Detected delimiter: ${parseInfo.delimiter}`;
            }

            return rows;
        } catch (e) {
            console.error('CSV load failed:', e);
            showWarn('Failed to load refined_jobs.csv. See console for details.');
            return null;
        }
    };

    const init = async () => {
        const rows = await loadCSV();
        if (!rows) return;
        const data = processData(rows);
        renderDashboard(data);
    };

    init();

    const processData = (rows) => {
        let lastUpdated = null;

        const parseDateSmart = (value) => {
            const s = String(value ?? '').trim();
            if (!s) return null;
            const m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
            if (m) {
                const day = m[1].padStart(2, '0');
                const month = m[2].padStart(2, '0');
                let year = m[3];
                if (year.length === 2) year = (parseInt(year, 10) >= 70 ? '19' : '20') + year;
                return new Date(Date.UTC(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10)));
            }
            const d = new Date(s);
            return isNaN(d.getTime()) ? null : d;
        };

        const processedRows = rows.map(row => {
            const date = parseDateSmart(row['Date']);
            if (!date) return null;

            const bookingName = String(row['Booking Name'] ?? '').trim();
            const employeesRaw = String(row['Employees'] ?? '').trim();
            const costRaw = String(row['Cost'] ?? '');
            const hoursRaw = String(row['Hours Paid Out'] ?? '');

            const employees = employeesRaw ? employeesRaw.split(',').map(e => e.trim()).filter(Boolean) : [];

            const valueNumber = parseMoney(costRaw);
            const paidHours = parsePaidHours(hoursRaw);

            const isCancelled = bookingName.toLowerCase().includes('cancelled');
            const isTouchUp = bookingName.toLowerCase().includes('touch up');
            const hasGST = costRaw.toLowerCase().includes('+ gst');
            const isBillable = valueNumber > 0 && !isCancelled && !isTouchUp;

            const year = String(date.getUTCFullYear());
            const month = String(date.getUTCMonth() + 1).padStart(2, '0');
            const day = String(date.getUTCDate()).padStart(2, '0');

            if (!lastUpdated || date > lastUpdated) {
                lastUpdated = date;
            }

            return {
                date,
                dateKey: `${year}-${month}-${day}`,
                bookingName,
                employees,
                value: valueNumber,
                paidHours,
                isCancelled,
                isTouchUp,
                hasGST,
                isBillable
            };
        }).filter(Boolean);

        return { rows: processedRows, lastUpdated };
    };

    const renderDashboard = (data) => {
        renderSummaryBadges(data.rows);
        renderWeeklyRevenue(data.rows);
        renderMonthlyRevenue(data.rows);
        renderBusiestDays(data.rows);
        renderTopEmployees(data.rows);
        renderBestHourly(data.rows);
renderBestPerJob(data.rows);
        document.getElementById('last-updated').innerText = `Loaded ${parseInfo.count} rows · Detected delimiter: ${parseInfo.delimiter} · Last updated: ${formatDateAU(data.lastUpdated)}`;
    };

    const renderSummaryBadges = (rows) => {
        const billableJobs = rows.filter(r => r.isBillable);
        const totalRevenue = billableJobs.reduce((sum, r) => sum + r.value, 0);
        const totalPaidHours = rows.reduce((sum, r) => sum + (r.paidHours || 0), 0);

        document.getElementById('total-jobs').innerText = rows.length;
        document.getElementById('billable-jobs').innerText = billableJobs.length;
        document.getElementById('total-revenue').innerText = formatAUD(totalRevenue);
        document.getElementById('total-paid-hours').innerText = totalPaidHours.toFixed(1);
    };

    const renderWeeklyRevenue = (rows) => {
        const weeklyData = rows.filter(r => r.isBillable).reduce((acc, row) => {
            const monday = getMonday(row.date);
            const weekKey = monday.toISOString().split('T')[0];
            acc[weekKey] = (acc[weekKey] || 0) + row.value;
            return acc;
        }, {});

        const sortedWeeks = Object.keys(weeklyData).sort();
        const labels = sortedWeeks.map(wk => formatDateAU(new Date(wk)));
        const values = sortedWeeks.map(wk => weeklyData[wk]);

        new Chart(document.getElementById('chart-weekly'), {
            type: 'line',
            data: { labels, datasets: [{ label: 'Weekly Revenue', data: values, tension: 0.1, backgroundColor: 'rgba(54, 162, 235, 0.2)', borderColor: 'rgba(54, 162, 235, 1)' }] },
            options: { scales: { y: { beginAtZero: true } } }
        });
    };

    const renderMonthlyRevenue = (rows) => {
        const monthlyData = rows.filter(r => r.isBillable).reduce((acc, row) => {
            const monthKey = `${row.date.getUTCFullYear()}-${String(row.date.getUTCMonth() + 1).padStart(2, '0')}`;
            acc[monthKey] = (acc[monthKey] || 0) + row.value;
            return acc;
        }, {});

        const sortedMonths = Object.keys(monthlyData).sort();
        const labels = sortedMonths.map(m => new Date(m + '-02').toLocaleString('en-AU', { month: 'short', year: 'numeric', timeZone:'UTC' }));
        const values = sortedMonths.map(m => monthlyData[m]);

        new Chart(document.getElementById('chart-monthly'), {
            type: 'bar',
            data: { labels, datasets: [{ label: 'Monthly Revenue', data: values, backgroundColor: 'rgba(75, 192, 192, 0.2)', borderColor: 'rgba(75, 192, 192, 1)', borderWidth: 1 }] },
            options: { scales: { y: { beginAtZero: true } } }
        });
    };

    const renderBusiestDays = (rows) => {
        const dailyData = rows.filter(r => r.isBillable).reduce((acc, row) => {
            acc[row.dateKey] = acc[row.dateKey] || { jobs: 0, revenue: 0 };
            acc[row.dateKey].jobs++;
            acc[row.dateKey].revenue += row.value;
            return acc;
        }, {});

        const topDays = Object.entries(dailyData)
            .sort(([, a], [, b]) => b.revenue - a.revenue)
            .slice(0, 10);

        const tbody = document.querySelector('#table-busiest-days tbody');
        tbody.innerHTML = topDays.map(([dateKey, data]) => `
            <tr>
                <td>${formatDateAU(new Date(dateKey + 'T00:00:00Z'))}</td>
                <td>${data.jobs}</td>
                <td>${formatAUD(data.revenue)}</td>
            </tr>
        `).join('');
    };

    const renderTopEmployees = (rows) => {
        const employeeRevenue = rows.filter(r => r.isBillable).reduce((acc, row) => {
            row.employees.forEach(employee => {
                acc[employee] = (acc[employee] || 0) + row.value;
            });
            return acc;
        }, {});

        const topEmployees = Object.entries(employeeRevenue)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10);
            
        new Chart(document.getElementById('chart-employee-top'), {
            type: 'bar',
            data: { 
                labels: topEmployees.map(e => e[0]), 
                datasets: [{ label: 'Top Earning Employees', data: topEmployees.map(e => e[1]), backgroundColor: 'rgba(153, 102, 255, 0.2)', borderColor: 'rgba(153, 102, 255, 1)', borderWidth: 1 }] 
            },
            options: { indexAxis: 'y', scales: { x: { beginAtZero: true } } }
        });
    };

    const renderBestHourly = (rows) => {
        const employeeData = {};
        rows.forEach(row => {
            if (!row.employees.length) return;
            
            const hasPaidHours = row.paidHours != null;
            const isBillable = row.isBillable;

            row.employees.forEach(employee => {
                if (!employeeData[employee]) {
                    employeeData[employee] = { jobsWithPaidHours: 0, paidHours: 0, revenue: 0 };
                }
                
                if (hasPaidHours) {
                    employeeData[employee].jobsWithPaidHours++;
                    employeeData[employee].paidHours += row.paidHours;
                }
                if (isBillable) {
                    employeeData[employee].revenue += row.value;
                }
            });
        });

        const hourlyPerformance = Object.entries(employeeData)
            .filter(([, data]) => data.jobsWithPaidHours >= 5)
            .map(([employee, data]) => ({
                employee,
                ...data,
                perHour: data.paidHours > 0 ? data.revenue / data.paidHours : 0
            }))
            .sort((a, b) => b.perHour - a.perHour)
            .slice(0, 10);

        const tbody = document.querySelector('#table-best-hourly tbody');
        tbody.innerHTML = hourlyPerformance.map(e => `
            <tr>
                <td>${e.employee}</td>
                <td>${e.jobsWithPaidHours}</td>
                <td>${e.paidHours.toFixed(1)}</td>
                <td>${formatAUD(e.revenue)}</td>
                <td>${formatAUD(e.perHour)}</td>
            </tr>
        `).join('');
    };
const renderBestPerJob = (rows) => {
        const employeeData = {};
        rows.forEach(row => {
            if (!row.employees.length) return;
            
            // Only consider billable jobs (positive revenue, not cancelled/touch-ups)
            if (!row.isBillable) return;
            
            row.employees.forEach(employee => {
                if (!employeeData[employee]) {
                    employeeData[employee] = { paidJobs: 0, revenue: 0 };
                }
                
                // Each employee gets credited with the full revenue of a job they participated in
                employeeData[employee].paidJobs++;
                employeeData[employee].revenue += row.value;
            });
        });
        
        // Calculate revenue per paid job and filter employees with 5+ paid jobs
        const jobPerformance = Object.entries(employeeData)
            .filter(([, data]) => data.paidJobs >= 5)
            .map(([employee, data]) => ({
                employee,
                ...data,
                perJob: data.paidJobs > 0 ? data.revenue / data.paidJobs : 0
            }))
            .sort((a, b) => b.perJob - a.perJob);
        
        // Render the table
        const tbody = document.querySelector('#table-best-job tbody');
        tbody.innerHTML = jobPerformance.map(e => `
            <tr>
                <td>${e.employee}</td>
                <td>${e.paidJobs}</td>
                <td>${formatAUD(e.revenue)}</td>
                <td>${formatAUD(e.perJob)}</td>
            </tr>
        `).join('');
    };
});