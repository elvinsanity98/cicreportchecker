// Builders for fictitious CSDF records, shared by the tests and tools/make_samples.js.
const SPEC = require('../src/spec.js');

// values: { 'Field Name' or position: value }
function rec(type, values) {
  const defs = SPEC.RECORDS[type].fields;
  const out = new Array(defs.length).fill('');
  out[0] = type;
  for (const key of Object.keys(values || {})) {
    const idx = /^\d+$/.test(key) ? Number(key) - 1 : defs.findIndex((d) => d.name === key);
    if (idx < 0 || idx >= defs.length) throw new Error(`${type}: no field "${key}"`);
    out[idx] = values[key];
  }
  return out.join('|');
}

const PROVIDER = 'BANK1234';
const REF = '30062026';
const base = { 'Provider Code': PROVIDER, 'Branch Code': 'B0001' };

function individual(no, first, last, extra) {
  return rec('ID', Object.assign({}, base, {
    'Subject Reference Date': REF, 'Provider Subject No': no, 'Title': '10',
    'First Name': first, 'Last Name': last, 'Middle Name': 'REYES', 'Gender': 'M',
    'Date of Birth': '12111989', 'Place of Birth': 'QUEZON CITY', 'Country of Birth (Code)': 'PH',
    'Nationality': 'PH', 'Resident': '1', 'Civil Status': '2',
    'Address 1: Address Type': 'MI', 'Address 1: FullAddress': '23 MABINI ST, BRGY SAN ROQUE, QUEZON CITY',
    'Address 1: Country': 'PH',
    'Identification 1: Type': '10', 'Identification 1: Number': '123456789000',
    'Contact 1: Type': '3', 'Contact 1: Value': '09171234567'
  }, extra));
}

function business(no, name, extra) {
  return rec('BD', Object.assign({}, base, {
    'Subject Reference Date': REF, 'Provider Subject No': no, 'Trade Name': name,
    'Nationality': 'PH', 'Resident': '1', 'Legal Form': '15', 'Registration Date': '15032010', 'Firm Size': 'S',
    'Address 1: Address Type': 'MT', 'Address 1: FullAddress': '45 RIZAL AVE, MAKATI CITY', 'Address 1: Country': 'PH',
    'Identification 1: Type': '10', 'Identification 1: Number': '987654321000',
    'Contact 1: Type': '1', 'Contact 1: Value': '0288887777'
  }, extra));
}

function contractBase(subject, contractNo, type, extra) {
  return Object.assign({}, base, {
    'Contract Reference Date': REF, 'Provider Subject No': subject, 'Role': 'B',
    'Provider Contract No': contractNo, 'Contract Type': type, 'Contract Phase': 'AC',
    'Currency': 'PHP', 'Original Currency': 'PHP', 'Contract Start Date': '01052024',
    'Contract Request Date': '15042024', 'Contract End Planned Date': '01052029'
  }, extra);
}

function installment(subject, contractNo, extra) {
  return rec('CI', contractBase(subject, contractNo, '12', Object.assign({
    'Reorganized Credit Code': '0', 'Financed Amount': '100000', 'Installments Number': '60',
    'Transaction Type / Sub-facility': 'NA', 'Payment Periodicity': 'M', 'Payment Method': 'CAS',
    'Monthly Payment Amount': '2100', 'Outstanding Payments Number': '34', 'Outstanding Balance': '71400',
    'Overdue Payments Number': '0', 'Overdue Payments Amount': '0', 'Overdue Days': '0'
  }, extra)));
}

function cleanLines() {
  const lines = [
    `HD|${PROVIDER}|${REF}|1.0|0|JUNE 2026 REGULAR SUBMISSION`,
    individual('IND-0001', 'JUAN', 'DELA CRUZ'),
    individual('IND-0002', 'MARIA', 'SANTOS', { 'Title': '11', 'Gender': 'F', 'Date of Birth': '03071992' }),
    individual('IND-0003', 'PEDRO', 'GARCIA', { 'Date of Birth': '21021975', 'Contact 2: Type': '7', 'Contact 2: Value': 'pedro.garcia@example.com' }),
    business('COM-0001', 'SAMPLE TRADING CORP'),
    rec('SL', Object.assign({}, base, {
      'Subject Link Reference Date': REF, 'Provider Subject No (Parent)': 'IND-0003',
      'Role of the Parent': 'D', 'Provider Subject No (Child)': 'COM-0001'
    })),
    installment('IND-0001', 'LN-2024-000101'),
    installment('IND-0002', 'LN-2024-000102', { 'Contract Type': '17', 'Financed Amount': '850000' }),
    rec('CN', contractBase('COM-0001', 'CL-2023-000007', '70', {
      'Reorganized Credit Code': '0', 'Credit Limit': '5000000', 'Transaction Type / Sub-facility': 'NA',
      'Utilisation / Outstanding Balance': '1250000', 'Overdue Payments Amount': '0'
    })),
    rec('CC', contractBase('IND-0002', 'CC-5500-000321', '31', {
      'Reorganized Credit Code': '0', 'Credit limit': '150000', 'Transaction Type / Sub-facility': 'PCC',
      'Payment Periodicity': 'M', 'Outstanding Balance': '23850', 'Overdue Payments Number': '0',
      'Overdue Payments Amount': '0', 'Flag Card Used': '1', 'Premium Card': '0'
    })),
    rec('CS', contractBase('IND-0001', 'UT-0000456', '81', {
      'Payment Periodicity': 'M', 'Billed Amount': '1299', 'Outstanding Balance': '1299', 'Holder Liability': '1'
    })),
    rec('NE', Object.assign({}, base, {
      'Negative Event Reference Date': REF, 'Provider Subject No': 'COM-0001', 'Event Code': 'Z',
      'Event Detail': 'LEGAL ACTION', 'Event Date': '11062025', 'Event Status': 'AC'
    }))
  ];
  lines.push(`FT|${PROVIDER}|${REF}|${lines.length + 1}`);
  return lines;
}

// A file with typical mistakes, one or more per record.
function brokenLines() {
  const lines = [
    'Record Type|Provider Code|File Reference Date|Version|Submission Type|Provider Comments',
    `HD|${PROVIDER}|30062026|1|2|`,
    individual('IND-0001', 'JUAN', 'DELA CRUZ', { 'Date of Birth': '1211989', 'Gender': 'm' }),
    individual('IND-0001', 'MARIA', '', { 'Nationality': 'PHL', 'Subject Reference Date': '31072026' }),
    individual('IND-0003', ' PEDRO', 'GARCIA', { 'Date of Birth': '1975-02-21', 'Identification 1: Number': '', 'Contact 1: Type': '7' }),
    // Everything wrong on this record can be corrected by the auto-fixer
    // (the comma in the last name only with symbol removal switched on).
    individual('IND-0004', 'ANA  MARIE', 'DELOS SANTOS, JR.', {
      'Gender': 'Female', 'Date of Birth': '25/03/1990', 'Civil Status': 'Married', 'Nationality': 'PHILIPPINES',
      'Identification 1: Number': '123-456-789-000', 'Address 1: FullAddress': '#12 RIZAL ST.,  BRGY. STO. NIÑO, LILOY'
    }),
    business('COM-0001', 'SAMPLE TRADING CORP', { 'Provider Code': 'BANK9999', 'Legal Form': '99', 'Gross Income / Annual Turnover': '1,250,000.00' }),
    installment('IND-0001', 'LN-2024-000101', { 'Contract Phase': 'CL', 'Overdue Payments Number': '2' }),
    installment('IND-0001', 'LN-2024-000101'),
    installment('IND-0099', 'LN-2024-000103', { 'Contract Type': '31', 'Currency': 'PESO', 'Contract End Planned Date': '01052023' }),
    '',
    rec('NE', Object.assign({}, base, {
      'Negative Event Reference Date': REF, 'Provider Subject No': 'COM-0001', 'Event Code': 'X', 'Event Date': '11062025'
    }))
  ];
  lines.push(`FT|${PROVIDER}|${REF}|99`);
  return lines;
}

module.exports = { rec, individual, business, installment, contractBase, cleanLines, brokenLines, PROVIDER, REF };
