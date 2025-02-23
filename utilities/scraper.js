// scraper.js
(async function () {
    var data = 'verifyMenu=true&authorizedID=' + $('#authorizedIDX').val() + '&_csrf=' + $('input[name="_csrf"]').val() + '&nocache=' + new Date().getTime();
    var response = {};

    try {
        const res = await $.ajax({
            type: 'POST',
            url: 'academics/common/StudentTimeTable',
            data: data,
        });

        if (res.toLowerCase().includes('time table')) {
            var doc = new DOMParser().parseFromString(res, 'text/html');
            var options = doc.getElementById('semesterSubId').getElementsByTagName('option');
            var semesters = [];

            for (var i = 0; i < options.length; ++i) {
                if (!options[i].value) {
                    continue;
                }
                var semester = {
                    name: options[i].innerText,
                    id: options[i].value
                };
                semesters.push(semester);
            }

            response.semesters = semesters;
        }
    } catch (error) {
        console.error('Error fetching data:', error);
    }

    return JSON.stringify(response);
})();