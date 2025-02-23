(async function () {
    var data = '_csrf=' + $('input[name="_csrf"]').val() + 
               '&authorizedID=' + $('#authorizedIDX').val() + 
               '&verifyMenu=true&nocache=' + new Date().getTime();

    var response = {};

    try {
        const res = await $.ajax({
            type: 'POST',
            url: 'examinations/examGradeView/StudentGradeHistory',
            data: data,
        });

        var doc = new DOMParser().parseFromString(res, 'text/html');
        var tables = doc.getElementsByTagName('table');

        for (var i = tables.length - 1; i >= 0; --i) {
            var headings = tables[i].getElementsByTagName('tr')[0].getElementsByTagName('td');

            if (headings[0].innerText.toLowerCase().includes('credits')) {
                var creditsIndex, cgpaIndex;

                for (var j = 0; j < headings.length; ++j) {
                    var heading = headings[j].innerText.toLowerCase();

                    if (heading.includes('earned')) {
                        creditsIndex = j + headings.length;
                    } else if (heading.includes('cgpa')) {
                        cgpaIndex = j + headings.length;
                    }
                }

                var cells = tables[i].getElementsByTagName('td');

                response.cgpa = parseFloat(cells[cgpaIndex].innerText) || 0;
                response.total_credits = parseFloat(cells[creditsIndex].innerText) || 0;
                break;
            }
        }
    } catch (error) {
        console.error('Error fetching grade data:', error);
    }

    return JSON.stringify(response);
})();
