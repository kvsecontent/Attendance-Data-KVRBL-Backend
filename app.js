// This function replaces the existing processStudentData in your app.js

function processStudentData(sheetsData, admissionNumber) {
  try {
    // Extract value ranges from the response
    const [studentsSheet, subjectsSheet, activitiesSheet, 
           assignmentsSheet, testsSheet, correctionsSheet, 
           attendanceSheet] = sheetsData.valueRanges;
    
    // Extract headers from each sheet
    const studentsHeaders = studentsSheet.values[0];
    const subjectsHeaders = subjectsSheet.values[0];
    const activitiesHeaders = activitiesSheet.values[0];
    const assignmentsHeaders = assignmentsSheet.values[0];
    const testsHeaders = testsSheet.values[0];
    const correctionsHeaders = correctionsSheet.values[0];
    const attendanceHeaders = attendanceSheet.values[0];
    
    // Find student info - basic info still has one row per student
    const studentData = findStudentByAdmissionNo(studentsSheet.values, studentsHeaders, admissionNumber);
    
    if (!studentData) {
      throw new Error(`Student with admission number ${admissionNumber} not found`);
    }
    
    // Extract student basic info - this remains the same
    const studentInfo = {
      name: getValueByHeader(studentData, studentsHeaders, 'name'),
      class: getValueByHeader(studentData, studentsHeaders, 'class'),
      admissionNo: getValueByHeader(studentData, studentsHeaders, 'admission_no'),
      rollNo: getValueByHeader(studentData, studentsHeaders, 'roll_no'),
      dob: getValueByHeader(studentData, studentsHeaders, 'dob'),
      contact: getValueByHeader(studentData, studentsHeaders, 'contact'),
      photoUrl: getValueByHeader(studentData, studentsHeaders, 'photo_url') || '/api/placeholder/120/120'
    };
    
    // ==== NEW CODE: Process horizontal subjects data ====
    const subjectProgress = processHorizontalSubjects(subjectsSheet.values, subjectsHeaders, admissionNumber);
    
    // ==== NEW CODE: Process horizontal attendance data ====
    const attendance = processHorizontalAttendance(attendanceSheet.values, attendanceHeaders, admissionNumber);
    
    // For these sheets, we'll keep the vertical structure for flexibility
    // but we could convert them to horizontal if needed
    const subjectActivities = filterSheetByAdmissionNo(activitiesSheet.values, activitiesHeaders, admissionNumber)
      .map(row => ({
        subject: getValueByHeader(row, activitiesHeaders, 'subject'),
        activity: getValueByHeader(row, activitiesHeaders, 'activity'),
        date: getValueByHeader(row, activitiesHeaders, 'date'),
        description: getValueByHeader(row, activitiesHeaders, 'description'),
        status: getValueByHeader(row, activitiesHeaders, 'status')
      }));
    
    // Extract assignments
    const assignments = filterSheetByAdmissionNo(assignmentsSheet.values, assignmentsHeaders, admissionNumber)
      .map(row => ({
        subject: getValueByHeader(row, assignmentsHeaders, 'subject'),
        name: getValueByHeader(row, assignmentsHeaders, 'name'),
        assignedDate: getValueByHeader(row, assignmentsHeaders, 'assigned_date'),
        dueDate: getValueByHeader(row, assignmentsHeaders, 'due_date'),
        status: getValueByHeader(row, assignmentsHeaders, 'status'),
        remarks: getValueByHeader(row, assignmentsHeaders, 'remarks') || ''
      }));
    
    // Extract recent tests
    const allTests = filterSheetByAdmissionNo(testsSheet.values, testsHeaders, admissionNumber)
      .map(row => ({
        subject: getValueByHeader(row, testsHeaders, 'subject'),
        name: getValueByHeader(row, testsHeaders, 'name'),
        date: getValueByHeader(row, testsHeaders, 'date'),
        maxMarks: parseInt(getValueByHeader(row, testsHeaders, 'max_marks')),
        marksObtained: parseInt(getValueByHeader(row, testsHeaders, 'marks_obtained')),
        percentage: parseFloat(getValueByHeader(row, testsHeaders, 'percentage')),
        grade: getValueByHeader(row, testsHeaders, 'grade')
      }));
    
    // Sort tests by date (newest first) and take the 5 most recent
    const recentTests = [...allTests].sort((a, b) => {
      const dateA = new Date(a.date.split('-').reverse().join('-'));
      const dateB = new Date(b.date.split('-').reverse().join('-'));
      return dateB - dateA;
    }).slice(0, 5).map(test => ({
      subject: test.subject,
      name: test.name,
      date: test.date,
      marks: `${test.marksObtained}/${test.maxMarks}`,
      percentage: test.percentage,
      grade: test.grade
    }));
    
    // Extract copy corrections
    const corrections = filterSheetByAdmissionNo(correctionsSheet.values, correctionsHeaders, admissionNumber)
      .map(row => ({
        subject: getValueByHeader(row, correctionsHeaders, 'subject'),
        copyType: getValueByHeader(row, correctionsHeaders, 'copy_type'),
        date: getValueByHeader(row, correctionsHeaders, 'date'),
        improvements: getValueByHeader(row, correctionsHeaders, 'improvements'),
        remarks: getValueByHeader(row, correctionsHeaders, 'remarks')
      }));
    
    // Calculate summary statistics
    const completedAssignments = assignments.filter(a => a.status === 'complete').length;
    const pendingAssignments = assignments.filter(a => a.status === 'pending').length;
    const overallAttendance = attendance.length > 0 
      ? attendance.reduce((sum, month) => sum + month.percentage, 0) / attendance.length
      : 0;
    
    // Compile all data
    return {
      studentInfo,
      subjectProgress,
      recentTests,
      subjectActivities,
      assignments,
      tests: allTests,
      corrections,
      attendance,
      summary: {
        totalSubjects: subjectProgress.length,
        completedAssignments,
        pendingAssignments,
        attendancePercentage: `${overallAttendance.toFixed(1)}%`
      }
    };
  } catch (error) {
    console.error('Error processing student data:', error);
    throw error;
  }
}

// Process horizontally structured subjects data
function processHorizontalSubjects(values, headers, admissionNumber) {
  // Find the row for this student
  const admissionIndex = headers.findIndex(h => h.toLowerCase() === 'admission_no');
  if (admissionIndex === -1) return [];
  
  // Find the student's row
  let studentRow = null;
  for (let i = 1; i < values.length; i++) {
    if (values[i][admissionIndex] === admissionNumber) {
      studentRow = values[i];
      break;
    }
  }
  
  if (!studentRow) return [];
  
  // Process all subject columns
  // Format expected: subject_progress, subject_grade (math_progress, math_grade, etc.)
  const subjects = [];
  const progressSuffix = '_progress';
  const gradeSuffix = '_grade';
  
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i].toLowerCase();
    
    if (header.endsWith(progressSuffix)) {
      const subject = header.substring(0, header.length - progressSuffix.length);
      const progress = parseFloat(studentRow[i] || 0);
      
      // Find the matching grade column
      const gradeHeader = `${subject}${gradeSuffix}`;
      const gradeIndex = headers.findIndex(h => h.toLowerCase() === gradeHeader);
      const grade = gradeIndex !== -1 ? studentRow[gradeIndex] : '';
      
      // Only add subjects that have progress values
      if (!isNaN(progress) && progress > 0) {
        subjects.push({
          subject: capitalizeFirstLetter(subject),
          progress: progress,
          grade: grade
        });
      }
    }
  }
  
  return subjects;
}

// Process horizontally structured attendance data
function processHorizontalAttendance(values, headers, admissionNumber) {
  // Find the row for this student
  const admissionIndex = headers.findIndex(h => h.toLowerCase() === 'admission_no');
  if (admissionIndex === -1) return [];
  
  // Find the student's row
  let studentRow = null;
  for (let i = 1; i < values.length; i++) {
    if (values[i][admissionIndex] === admissionNumber) {
      studentRow = values[i];
      break;
    }
  }
  
  if (!studentRow) return [];
  
  // Process all month columns
  // Format expected: month_working, month_present, month_absent, month_percent
  const attendance = [];
  const workingSuffix = '_working';
  const presentSuffix = '_present';
  const absentSuffix = '_absent';
  const percentSuffix = '_percent';
  
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i].toLowerCase();
    
    if (header.endsWith(workingSuffix)) {
      const month = header.substring(0, header.length - workingSuffix.length);
      const workingDays = parseInt(studentRow[i] || 0);
      
      // Find matching columns
      const presentIndex = headers.findIndex(h => h.toLowerCase() === `${month}${presentSuffix}`);
      const absentIndex = headers.findIndex(h => h.toLowerCase() === `${month}${absentSuffix}`);
      const percentIndex = headers.findIndex(h => h.toLowerCase() === `${month}${percentSuffix}`);
      
      const present = presentIndex !== -1 ? parseInt(studentRow[presentIndex] || 0) : 0;
      const absent = absentIndex !== -1 ? parseInt(studentRow[absentIndex] || 0) : 0;
      const percentage = percentIndex !== -1 ? parseFloat(studentRow[percentIndex] || 0) : 0;
      
      // Only add months that have working days
      if (!isNaN(workingDays) && workingDays > 0) {
        attendance.push({
          month: capitalizeFirstLetter(month),
          workingDays: workingDays,
          present: present,
          absent: absent,
          percentage: percentage
        });
      }
    }
  }
  
  return attendance;
}

// Utility function to capitalize first letter
function capitalizeFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

// Rest of the helper functions remain the same
function findStudentByAdmissionNo(values, headers, admissionNo) {
  const admissionIndex = headers.findIndex(h => h.toLowerCase() === 'admission_no');
  if (admissionIndex === -1) return null;
  
  // Skip header row (index 0) and find student
  for (let i = 1; i < values.length; i++) {
    if (values[i][admissionIndex] === admissionNo) {
      return values[i];
    }
  }
  
  return null;
}

function filterSheetByAdmissionNo(values, headers, admissionNo) {
  const admissionIndex = headers.findIndex(h => h.toLowerCase() === 'admission_no');
  if (admissionIndex === -1) return [];
  
  // Skip header row (index 0) and filter rows
  return values.slice(1).filter(row => row[admissionIndex] === admissionNo);
}

function getValueByHeader(row, headers, headerName) {
  const index = headers.findIndex(h => h.toLowerCase() === headerName.toLowerCase());
  return index !== -1 ? (row[index] || '') : '';
}
