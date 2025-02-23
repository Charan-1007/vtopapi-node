(async function () {
    var data = `semesterSubId=${semId}&authorizedID=${$('#authorizedIDX').val()}&_csrf=${$('input[name="_csrf"]').val()}`;
    var response = { marks: [] };

    try {
        const res = await $.ajax({
            type: 'POST',
            url: 'examinations/doStudentMarkView',
            data: data
        });

        if (res.toLowerCase().includes('no data found')) {
            return JSON.stringify(response);
        }

        var doc = new DOMParser().parseFromString(res, 'text/html');
        var table = doc.getElementById('fixedTableContainer');
        if (!table) throw new Error('Table not found in response');

        var rows = table.getElementsByTagName('tr');
        var headings = rows[0].getElementsByTagName('td');
        var courseTypeIndex, slotIndex;

        // Finding column indexes dynamically
        for (let i = 0; i < headings.length; i++) {
            let headingText = headings[i].innerText.toLowerCase();
            if (headingText.includes('course') && headingText.includes('type')) {
                courseTypeIndex = i;
            } else if (headingText.includes('slot')) {
                slotIndex = i;
            }
        }

        for (let i = 1; i < rows.length; i++) {
            let columns = rows[i].getElementsByTagName('td');

            let rawCourseType = columns[courseTypeIndex]?.innerText.trim().toLowerCase() || '';
            let courseType = rawCourseType.includes('lab') ? 'lab' :
                             rawCourseType.includes('project') ? 'project' : 'theory';

            let slot = columns[slotIndex]?.innerText.split('+')[0].trim() || null;

            let innerTable = rows[++i]?.getElementsByTagName('table')[0];
            if (!innerTable) continue;

            let innerCells = innerTable.getElementsByTagName('td');
            let titleIndex = 1, scoreIndex = 5, maxScoreIndex = 2, weightageIndex = 6, 
                maxWeightageIndex = 3, averageIndex = 0, statusIndex = 4;

            while (statusIndex < innerCells.length) {
                response.marks.push({
                    slot: slot,
                    course_type: courseType,
                    title: innerCells[titleIndex]?.innerText.trim() || '',
                    score: parseFloat(innerCells[scoreIndex]?.innerText) || 0,
                    max_score: parseFloat(innerCells[maxScoreIndex]?.innerText) || null,
                    weightage: parseFloat(innerCells[weightageIndex]?.innerText) || 0,
                    max_weightage: parseFloat(innerCells[maxWeightageIndex]?.innerText) || null,
                    average: parseFloat(innerCells[averageIndex]?.innerText) || null,
                    status: innerCells[statusIndex]?.innerText.trim() || ''
                });

                titleIndex += headings.length;
                scoreIndex += headings.length;
                maxScoreIndex += headings.length;
                weightageIndex += headings.length;
                maxWeightageIndex += headings.length;
                averageIndex += headings.length;
                statusIndex += headings.length;
            }

            i += innerTable.getElementsByTagName('tr').length - 1; // Skip inner table rows
        }

    } catch (error) {
        console.error('Error processing student marks:', error);
    }

    return JSON.stringify(response);
})();
