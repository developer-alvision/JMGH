// ==========================================================
// GOOGLE CALENDAR SYNC
//
// Two ways in, deliberately:
//   1. A subscription feed (one URL added once to Google
//      Calendar) that keeps a doctor's OP list and theatre list
//      on their phone and refreshes itself.
//   2. A per-event "Add to Google Calendar" link for the odd
//      appointment somebody wants pinned individually.
//
// The feed needs no OAuth consent screen and no stored refresh
// tokens — the URL carries a per-doctor HMAC that the
// calendarFeed function verifies.
// ==========================================================

// Builds a UTC timestamp (YYYYMMDDTHHMMSSZ) from an IST date and time.
function calendarUtcStamp(dateString, timeString, addMinutes) {
    var parts = String(dateString || '').split('-');
    if (parts.length !== 3) return '';

    var minutes = 9 * 60; // default to 09:00 IST when no time was recorded
    var match = String(timeString || '').trim().toUpperCase().match(/^(\d{1,2})[:.](\d{2})\s*(AM|PM)?/);
    if (match) {
        var hours = Number(match[1]);
        if (match[3] === 'PM' && hours < 12) hours += 12;
        if (match[3] === 'AM' && hours === 12) hours = 0;
        minutes = hours * 60 + Number(match[2]);
    }

    // IST is UTC+5:30, so subtract 330 minutes to get UTC.
    var date = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 0, minutes - 330 + (addMinutes || 0), 0));
    if (isNaN(date.getTime())) return '';
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
window.calendarUtcStamp = calendarUtcStamp;

function googleCalendarEventUrl(options) {
    var start = calendarUtcStamp(options.date, options.time, 0);
    var end = calendarUtcStamp(options.date, options.time, options.durationMinutes || 30);
    if (!start || !end) return '';

    var params = new URLSearchParams({
        action: 'TEMPLATE',
        text: options.title || 'Hospital appointment',
        dates: start + '/' + end,
        details: options.details || '',
        location: options.location || '',
        ctz: 'Asia/Kolkata'
    });
    return 'https://calendar.google.com/calendar/render?' + params.toString();
}
window.googleCalendarEventUrl = googleCalendarEventUrl;

// Small inline link for a table row.
function addToCalendarLinkHtml(options) {
    var url = googleCalendarEventUrl(options);
    if (!url) return '';
    return '<a href="' + url + '" target="_blank" rel="noopener" class="btn-secondary" '
        + 'style="padding:4px 8px;font-size:0.78rem;text-decoration:none;white-space:nowrap;" '
        + 'title="Add this one event to Google Calendar">'
        + '<i class="fa-regular fa-calendar-plus"></i> Calendar</a>';
}
window.addToCalendarLinkHtml = addToCalendarLinkHtml;

// ----------------------------------------------------------
// SUBSCRIPTION FEED
// ----------------------------------------------------------
function showCalendarFeedDialog() {
    showToast('Preparing your calendar link...', 'info');

    callFunction('getCalendarFeedUrl').then(function(result) {
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:100000;display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = '<div style="background:white;border-radius:12px;padding:26px;max-width:560px;width:92%;box-shadow:0 20px 60px rgba(0,0,0,0.25);">'
            + '<h3 style="margin:0 0 6px;color:#0F2B5B;font-size:16px;font-weight:700;">'
            + '<i class="fa-regular fa-calendar-check" style="color:#0D7A70;margin-right:8px;"></i>Your schedule on your phone</h3>'
            + '<p style="margin:0 0 14px;color:#64748b;font-size:13px;line-height:1.6;">'
            + 'Add this address to Google Calendar once. Your OP appointments and theatre list then appear on every '
            + 'device signed in to that account, and stay up to date on their own.</p>'
            + '<textarea readonly id="calendarFeedUrlBox" style="width:100%;height:70px;font-family:monospace;font-size:11.5px;padding:10px;border:1px solid #e2e8f0;border-radius:8px;resize:none;">'
            + escapeHtml(result.url) + '</textarea>'
            + '<ol style="margin:12px 0 0;padding-left:20px;color:#475569;font-size:12.5px;line-height:1.7;">'
            + '<li>Open Google Calendar on a computer.</li>'
            + '<li>Under <strong>Other calendars</strong>, choose <strong>+</strong> → <strong>From URL</strong>.</li>'
            + '<li>Paste the address above and press <strong>Add calendar</strong>.</li>'
            + '</ol>'
            + '<p style="margin:12px 0 0;color:#b45309;font-size:12px;">'
            + '<i class="fa-solid fa-triangle-exclamation"></i> This link contains patient names. Treat it like a password '
            + 'and add it only to your own hospital account.</p>'
            + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px;">'
            + '<button class="cal-close btn-secondary">Close</button>'
            + '<button class="cal-copy btn-primary"><i class="fa-regular fa-copy"></i> Copy link</button>'
            + '</div></div>';

        document.body.appendChild(overlay);
        overlay.querySelector('.cal-close').onclick = function() { overlay.remove(); };
        overlay.onclick = function(event) { if (event.target === overlay) overlay.remove(); };
        overlay.querySelector('.cal-copy').onclick = function() {
            var box = document.getElementById('calendarFeedUrlBox');
            box.select();
            navigator.clipboard.writeText(result.url).then(function() {
                showToast('Calendar link copied.', 'success');
            }).catch(function() {
                showToast('Press Ctrl+C to copy the selected link.', 'info');
            });
        };
    }).catch(function(err) {
        console.error('Calendar feed error:', err);
        showToast(err.message || 'Could not build your calendar link.', 'error');
    });
}
window.showCalendarFeedDialog = showCalendarFeedDialog;

// Shows the "Sync to my calendar" button to the roles that have a schedule.
document.addEventListener('DOMContentLoaded', function() {
    var button = document.getElementById('calendarSyncBtn');
    if (!button) return;
    getCurrentUser(function(user) {
        var role = (user.role || '').toLowerCase();
        if (['admin', 'doctor', 'receptionist', 'owner'].indexOf(role) === -1) return;
        button.style.display = 'inline-flex';
        button.addEventListener('click', showCalendarFeedDialog);
    });
});
