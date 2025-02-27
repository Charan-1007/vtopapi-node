(async function () {
    var semesterID = semId;
    var authorizedID = $('#authorizedIDX').val();
    var csrfToken = $('input[name="_csrf"]').val();

    var data = `semesterSubId=${semesterID}&authorizedID=${authorizedID}&_csrf=${csrfToken}`;

    var response = {};

    try {
        const res = await $.ajax({
            type: 'POST',
            url: 'examinations/doSearchExamScheduleForStudent',
            data: data,
        });

        if (res.toLowerCase().includes('not found')) {
            return JSON.stringify(response);
        }

        var doc = new DOMParser().parseFromString(res, 'text/html');
        var slotIndex = 5, dateIndex = 6, timingIndex = 9, venueIndex = 10, locationIndex = 11, numberIndex = 12;
        var columns = doc.getElementsByTagName('tr')[1].getElementsByTagName('td');

        var examTitle = '';
        var exam = {};
        var cells = doc.getElementsByTagName('td');

        for (var i = columns.length; i < cells.length; ++i) {
            if (cells[i].colSpan > 1) {
                examTitle = cells[i].innerText.trim();
                response[examTitle] = [];
                continue;
            }

            var index = (i - Object.keys(response).length) % columns.length;

            if (index === slotIndex) {
                exam.slot = cells[i + 1].innerText.trim().split('+')[0];
            } else if (index === dateIndex) {
                var date = cells[i + 1].innerText.trim().toUpperCase();
                exam.date = date === '' ? null : date;
            } else if (index === timingIndex) {
                var timings = cells[i + 1].innerText.trim().split('-');

                exam.start_time = timings.length === 2 ? timings[0].trim() : null;
                exam.end_time = timings.length === 2 ? timings[1].trim() : null;
            } else if (index === venueIndex) {
                var venue = cells[i + 1].innerText.trim();
                exam.venue = venue.replace(/-/g, '') === '' ? null : venue;
            } else if (index === locationIndex) {
                var location = cells[i + 1].innerText.trim();
                exam.seat_location = location.replace(/-/g, '') === '' ? null : location;
            } else if (index === numberIndex) {
                var number = cells[i + 1].innerText.trim();
                exam.seat_number = number.replace(/-/g, '') === '' ? null : parseInt(number);
            }

            if (Object.keys(exam).length === 7) {
                response[examTitle].push(exam);
                exam = {};
            }
        }
    } catch (error) {
        console.error('Error fetching exam schedule:', error);
    }

    return JSON.stringify(response);
})();
