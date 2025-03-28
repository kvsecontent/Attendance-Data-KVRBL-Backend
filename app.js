const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Only need these two environment variables
const GOOGLE_SHEETS_ID = process.env.GOOGLE_SHEETS_ID;
const GOOGLE_SHEETS_API_KEY = process.env.GOOGLE_SHEETS_API_KEY;

// Allow requests from GitHub Pages (or any origin for development)
app.use(cors({
  origin: '*',  // Allow all origins, or specify your GitHub Pages URL
  methods: ['GET'], // Only allow GET requests
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Simple API endpoint to fetch student data by admission number
app.get('/api/student-data', async (req, res) => {
  try {
    const admissionNumber = req.query.admission;
    
    // Validate admission number
    if (!admissionNumber || !/^\d{5}$/.test(admissionNumber)) {
      return res.status(400).json({ error: 'Invalid admission number. Must be 5 digits.' });
    }
    
    // Google Sheets API endpoint with multiple ranges
    const sheetsEndpoint = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_ID}/values:batchGet`;
    
    // Define the ranges we want to fetch
    const ranges = [
      'Students!A:G',
      'Subjects!A:Z',  // Wider range to accommodate horizontal data
      'Activities!A:Z', // Wider range for horizontal activities
      'Assignments!A:Z', // Wider range for horizontal assignments
      'Tests!A:Z',      // Wider range for horizontal tests
      'Corrections!A:Z', // Wider range for horizontal corrections
      'Attendance!A:Z'   // Wider range for horizontal attendance
    ];
    
    // Build the full URL with query parameters
    const url = `${sheetsEndpoint}?key=${GOOGLE_SHEETS_API_KEY}&ranges=${ranges.map(range => encodeURIComponent(range)).join('&ranges=')}`;
    
    // Fetch data from Google Sheets
    const response = await axios.get(url);
    
    // Process the response to extract data for the specific student
    const processedData = processStudentData(response.data, admissionNumber);
    
    res.json(processedData);
  } catch (error) {
    console.error('Error fetching data from Google Sheets:', error);
    if (error.response && error.response.data) {
      console.error('Google API Error:', error.response.data);
    }
    res.status(500).json({ error: 'Failed to fetch data from Google Sheets' });
  }
});

// API status endpoint
app.get('/api/status', (req, res) => {
  res.json({ 
    status: 'online',
    message: 'Student Portfolio API is running',
    sheetsConfigured: Boolean(GOOGLE_SHEETS_ID && GOOGLE_SHEETS_API_KEY)
  });
});

// Process the Google Sheets response with horizontal data structure
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
    
    // Find student info row
    const studentData = findStudentByAdmissionNo(studentsSheet.values, studentsHeaders, admissionNumber);
    
    if (!studentData) {
      throw new Error(`Student with admission number ${admissionNumber} not found`);
    }
    
    // Extract student basic info
    const studentInfo = {
      name: getValueByHeader(studentData, studentsHeaders, 'name'),
      class: getValueByHeader(studentData, studentsHeaders, 'class'),
      admissionNo: getValueByHeader(studentData, studentsHeaders, 'admission_no'),
      rollNo: getValueByHeader(studentData, studentsHeaders, 'roll_no'),
      dob: getValueByHeader(studentData, studentsHeaders, 'dob'),
      contact: getValueByHeader(studentData, studentsHeaders, 'contact'),
      photoUrl: getValueByHeader(studentData, studentsHeaders, 'photo_url') || '/api/placeholder/120/120'
    };
    
    // Find student data rows for horizontal sheets
    const subjectRow = findStudentByAdmissionNo(subjectsSheet.values, subjectsHeaders, admissionNumber);
    const activitiesRow = findStudentByAdmissionNo(activitiesSheet.values, activitiesHeaders, admissionNumber);
    const assignmentsRow = findStudentByAdmissionNo(assignmentsSheet.values, assignmentsHeaders, admissionNumber);
    const testsRow = findStudentByAdmissionNo(testsSheet.values, testsHeaders, admissionNumber);
    const correctionsRow = findStudentByAdmissionNo(correctionsSheet.values, correctionsHeaders, admissionNumber);
    const attendanceRow = findStudentByAdmissionNo(attendanceSheet.values, attendanceHeaders, admissionNumber);
    
    // Process subjects (horizontal format)
    const subjectProgress = processHorizontalSubjects(subjectRow, subjectsHeaders);
    
    // Process activities (horizontal format)
    const subjectActivities = processHorizontalActivities(activitiesRow, activitiesHeaders);
    
    // Process assignments (horizontal format)
    const assignments = processHorizontalAssignments(assignmentsRow, assignmentsHeaders);
    
    // Process tests (horizontal format)
    const allTests = processHorizontalTests(testsRow, testsHeaders);
    
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
    
    // Process corrections (horizontal format)
    const corrections = processHorizontalCorrections(correctionsRow, correctionsHeaders);
    
    // Process attendance (horizontal format)
    const attendance = processHorizontalAttendance(attendanceRow, attendanceHeaders);
    
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
function processHorizontalSubjects(studentRow, headers) {
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
          subject: capitalizeFirstLetter(subject.replace('_', ' ')),
          progress: progress,
          grade: grade
        });
      }
    }
  }
  
  return subjects;
}

// Process horizontally structured activities data
function processHorizontalActivities(studentRow, headers) {
  if (!studentRow) return [];
  
  const activities = [];
  // Format expected: subject_activity1, subject_activity1_date, subject_activity1_description, subject_activity1_status
  // Then subject_activity2, etc.
  
  // First, identify all subjects and activities
  const activityMap = {};
  
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i].toLowerCase();
    
    // Look for subject_activityN pattern
    const match = header.match(/^([a-z]+)_activity(\d+)$/);
    if (match) {
      const subject = match[1];
      const activityNum = match[2];
      const activityKey = `${subject}_activity${activityNum}`;
      
      if (!activityMap[activityKey]) {
        activityMap[activityKey] = { subject: subject };
      }
      
      activityMap[activityKey].name = studentRow[i];
      
      // Look for related fields
      const dateIndex = headers.findIndex(h => h.toLowerCase() === `${activityKey}_date`);
      const descIndex = headers.findIndex(h => h.toLowerCase() === `${activityKey}_description`);
      const statusIndex = headers.findIndex(h => h.toLowerCase() === `${activityKey}_status`);
      
      if (dateIndex !== -1) activityMap[activityKey].date = studentRow[dateIndex];
      if (descIndex !== -1) activityMap[activityKey].description = studentRow[descIndex];
      if (statusIndex !== -1) activityMap[activityKey].status = studentRow[statusIndex];
    }
  }
  
  // Convert the map to an array
  for (const key in activityMap) {
    const activity = activityMap[key];
    // Only add activities that have a name and are not empty
    if (activity.name && activity.name.trim() !== '') {
      activities.push({
        subject: capitalizeFirstLetter(activity.subject.replace('_', ' ')),
        activity: activity.name,
        date: activity.date || '',
        description: activity.description || '',
        status: activity.status || 'pending'
      });
    }
  }
  
  return activities;
}

// Process horizontally structured assignments data
function processHorizontalAssignments(studentRow, headers) {
  if (!studentRow) return [];
  
  const assignments = [];
  // Format expected: subject_assignment1, subject_assignment1_assigned_date, subject_assignment1_due_date, 
  // subject_assignment1_status, subject_assignment1_remarks
  
  // First, identify all subjects and assignments
  const assignmentMap = {};
  
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i].toLowerCase();
    
    // Look for subject_assignmentN pattern
    const match = header.match(/^([a-z]+)_assignment(\d+)$/);
    if (match) {
      const subject = match[1];
      const assignmentNum = match[2];
      const assignmentKey = `${subject}_assignment${assignmentNum}`;
      
      if (!assignmentMap[assignmentKey]) {
        assignmentMap[assignmentKey] = { subject: subject };
      }
      
      assignmentMap[assignmentKey].name = studentRow[i];
      
      // Look for related fields
      const assignedIndex = headers.findIndex(h => h.toLowerCase() === `${assignmentKey}_assigned_date`);
      const dueIndex = headers.findIndex(h => h.toLowerCase() === `${assignmentKey}_due_date`);
      const statusIndex = headers.findIndex(h => h.toLowerCase() === `${assignmentKey}_status`);
      const remarksIndex = headers.findIndex(h => h.toLowerCase() === `${assignmentKey}_remarks`);
      
      if (assignedIndex !== -1) assignmentMap[assignmentKey].assignedDate = studentRow[assignedIndex];
      if (dueIndex !== -1) assignmentMap[assignmentKey].dueDate = studentRow[dueIndex];
      if (statusIndex !== -1) assignmentMap[assignmentKey].status = studentRow[statusIndex];
      if (remarksIndex !== -1) assignmentMap[assignmentKey].remarks = studentRow[remarksIndex];
    }
  }
  
  // Convert the map to an array
  for (const key in assignmentMap) {
    const assignment = assignmentMap[key];
    // Only add assignments that have a name and are not empty
    if (assignment.name && assignment.name.trim() !== '') {
      assignments.push({
        subject: capitalizeFirstLetter(assignment.subject.replace('_', ' ')),
        name: assignment.name,
        assignedDate: assignment.assignedDate || '',
        dueDate: assignment.dueDate || '',
        status: assignment.status || 'pending',
        remarks: assignment.remarks || ''
      });
    }
  }
  
  return assignments;
}

// Process horizontally structured tests data
function processHorizontalTests(studentRow, headers) {
  if (!studentRow) return [];
  
  const tests = [];
  // Format expected: subject_test1, subject_test1_date, subject_test1_max_marks, subject_test1_marks_obtained, 
  // subject_test1_percentage, subject_test1_grade
  
  // First, identify all subjects and tests
  const testMap = {};
  
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i].toLowerCase();
    
    // Look for subject_testN pattern
    const match = header.match(/^([a-z]+)_test(\d+)$/);
    if (match) {
      const subject = match[1];
      const testNum = match[2];
      const testKey = `${subject}_test${testNum}`;
      
      if (!testMap[testKey]) {
        testMap[testKey] = { subject: subject };
      }
      
      testMap[testKey].name = studentRow[i];
      
      // Look for related fields
      const dateIndex = headers.findIndex(h => h.toLowerCase() === `${testKey}_date`);
      const maxMarksIndex = headers.findIndex(h => h.toLowerCase() === `${testKey}_max_marks`);
      const marksObtainedIndex = headers.findIndex(h => h.toLowerCase() === `${testKey}_marks_obtained`);
      const percentageIndex = headers.findIndex(h => h.toLowerCase() === `${testKey}_percentage`);
      const gradeIndex = headers.findIndex(h => h.toLowerCase() === `${testKey}_grade`);
      
      if (dateIndex !== -1) testMap[testKey].date = studentRow[dateIndex];
      if (maxMarksIndex !== -1) testMap[testKey].maxMarks = parseInt(studentRow[maxMarksIndex]);
      if (marksObtainedIndex !== -1) testMap[testKey].marksObtained = parseInt(studentRow[marksObtainedIndex]);
      if (percentageIndex !== -1) testMap[testKey].percentage = parseFloat(studentRow[percentageIndex]);
      if (gradeIndex !== -1) testMap[testKey].grade = studentRow[gradeIndex];
    }
  }
  
  // Convert the map to an array
  for (const key in testMap) {
    const test = testMap[key];
    // Only add tests that have a name and are not empty
    if (test.name && test.name.trim() !== '') {
      tests.push({
        subject: capitalizeFirstLetter(test.subject.replace('_', ' ')),
        name: test.name,
        date: test.date || '',
        maxMarks: !isNaN(test.maxMarks) ? test.maxMarks : 0,
        marksObtained: !isNaN(test.marksObtained) ? test.marksObtained : 0,
        percentage: !isNaN(test.percentage) ? test.percentage : 0,
        grade: test.grade || ''
      });
    }
  }
  
  return tests;
}

// Process horizontally structured corrections data
function processHorizontalCorrections(studentRow, headers) {
  if (!studentRow) return [];
  
  const corrections = [];
  // Format expected: subject_correction1, subject_correction1_date, subject_correction1_improvements, subject_correction1_remarks
  
  // First, identify all subjects and corrections
  const correctionMap = {};
  
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i].toLowerCase();
    
    // Look for subject_correctionN pattern
    const match = header.match(/^([a-z]+)_correction(\d+)$/);
    if (match) {
      const subject = match[1];
      const correctionNum = match[2];
      const correctionKey = `${subject}_correction${correctionNum}`;
      
      if (!correctionMap[correctionKey]) {
        correctionMap[correctionKey] = { subject: subject };
      }
      
      correctionMap[correctionKey].copyType = studentRow[i];
      
      // Look for related fields
      const dateIndex = headers.findIndex(h => h.toLowerCase() === `${correctionKey}_date`);
      const improvementsIndex = headers.findIndex(h => h.toLowerCase() === `${correctionKey}_improvements`);
      const remarksIndex = headers.findIndex(h => h.toLowerCase() === `${correctionKey}_remarks`);
      
      if (dateIndex !== -1) correctionMap[correctionKey].date = studentRow[dateIndex];
      if (improvementsIndex !== -1) correctionMap[correctionKey].improvements = studentRow[improvementsIndex];
      if (remarksIndex !== -1) correctionMap[correctionKey].remarks = studentRow[remarksIndex];
    }
  }
  
  // Convert the map to an array
  for (const key in correctionMap) {
    const correction = correctionMap[key];
    // Only add corrections that have a copyType and are not empty
    if (correction.copyType && correction.copyType.trim() !== '') {
      corrections.push({
        subject: capitalizeFirstLetter(correction.subject.replace('_', ' ')),
        copyType: correction.copyType,
        date: correction.date || '',
        improvements: correction.improvements || '',
        remarks: correction.remarks || ''
      });
    }
  }
  
  return corrections;
}

// Process horizontally structured attendance data
function processHorizontalAttendance(studentRow, headers) {
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

// Helper function to find a student by admission number
function findStudentByAdmissionNo(values, headers, admissionNo) {
  const admissionIndex = headers.findIndex(h => h.toLowerCase() === 'admission_no');
  if (admissionIndex === -1) return null;
  
  // Skip header row (index 0) and find student
  for (let i = 1; i < values.length; i++) {
    if (values[i] && values[i][admissionIndex] === admissionNo) {
      return values[i];
    }
  }
  
  return null;
}

// Helper function to get a value by header name
function getValueByHeader(row, headers, headerName) {
  const index = headers.findIndex(h => h.toLowerCase() === headerName.toLowerCase());
  return index !== -1 ? (row[index] || '') : '';
}

// Utility function to capitalize first letter
function capitalizeFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Google Sheets ID configured: ${Boolean(GOOGLE_SHEETS_ID)}`);
  console.log(`Google Sheets API Key configured: ${Boolean(GOOGLE_SHEETS_API_KEY)}`);
});

module.exports = app;
