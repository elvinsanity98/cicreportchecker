// Record layouts for the CIC Submission Data File (CSDF).
//
// Field order and names come from the "template" sheet of CIC's
// "Fields in Excel v1.7.xlsx"; field counts match the "Total Number of Fields"
// slide of the Overview deck (HD 6, ID 123, BD 49, SL 7, CI 143, CN 127,
// CC 143, CS 29, FT 4).
//
// Field definition: [name, type, options]
//   type   X = text, N = number, D = date (DDMMYYYY)
//   req    'M'  mandatory. Missing value is an error.
//          'E'  expected. CIC normally requires it, but the rule is not spelled
//               out in the manuals this tool was built from, so a missing
//               value is a warning. Promote to 'M' once confirmed.
//   max    maximum length (only where the manuals state one)
//   dom    code table in domains.js (array = any of several tables)
//   soft   format problems are warnings instead of errors
//   text   'name' = a person's name, 'free' = other free text (addresses,
//          trade names). Used for symbol checks and the optional auto-fixes.
(function (root) {
  function f(name, type, opts) {
    var d = { name: name, type: type || 'X' };
    if (opts) for (var k in opts) d[k] = opts[k];
    return d;
  }

  function address(prefix, typeDom) {
    return [
      f(prefix + ': Address Type', 'X', { dom: typeDom }),
      f(prefix + ': FullAddress', 'X', { text: 'free' }),
      f(prefix + ': StreetNo', 'X', { text: 'free' }),
      f(prefix + ': PostalCode'),
      f(prefix + ': Subdivision', 'X', { text: 'free' }),
      f(prefix + ': Barangay', 'X', { text: 'free' }),
      f(prefix + ': City', 'X', { text: 'free' }),
      f(prefix + ': Province', 'X', { text: 'free' }),
      f(prefix + ': Country', 'X', { dom: 'Country' }),
      f(prefix + ': House Owner/Lessee', 'X', { dom: 'HouseOwnerLessee' }),
      f(prefix + ': Occupied Since', 'D', { soft: true })
    ];
  }

  function pairs(prefix, count, typeLabel, valueLabel, dom) {
    var out = [];
    for (var i = 1; i <= count; i++) {
      out.push(f(prefix + ' ' + i + ': ' + typeLabel, 'X', { dom: dom }));
      out.push(f(prefix + ' ' + i + ': ' + valueLabel));
    }
    return out;
  }

  function idDocs() {
    var out = [];
    for (var i = 1; i <= 3; i++) {
      var p = 'ID ' + i + ': ';
      out.push(f(p + 'Type', 'X', { dom: 'IDType' }));
      out.push(f(p + 'Number'));
      out.push(f(p + 'IssueDate', 'D'));
      out.push(f(p + 'IssueCountry', 'X', { dom: 'Country' }));
      out.push(f(p + 'ExpiryDate', 'D'));
      out.push(f(p + 'Issued By', 'X', { text: 'free' }));
    }
    return out;
  }

  function guarantees() {
    var out = [];
    for (var i = 1; i <= 6; i++) {
      var p = 'Guarantee ' + i + ': ';
      out.push(f(p + 'Provider Guarantee No'));
      out.push(f(p + 'Provider Subject No (Guarantor)', 'X', { max: 38 }));
      out.push(f(p + 'Guarantor Name', 'X', { text: 'free' }));
      out.push(f(p + 'Guaranteed Amount', 'N'));
      out.push(f(p + 'Currency', 'X', { dom: 'Currency' }));
      out.push(f(p + 'Validity Start Date', 'D'));
      out.push(f(p + 'Validity End Date', 'D'));
      out.push(f(p + 'Guarantee Type', 'X', { dom: 'Guarantees' }));
      out.push(f(p + 'Asset Code'));
      out.push(f(p + 'Asset Description', 'X', { text: 'free' }));
      out.push(f(p + 'Asset Location', 'X', { text: 'free' }));
      out.push(f(p + 'Asset Appraised Value', 'N'));
      out.push(f(p + 'Asset Registry External Link'));
      out.push(f(p + 'Customer Type', 'X', { dom: 'GuaranteeCustomerType' }));
    }
    return out;
  }

  function linkedSubjects() {
    var out = [];
    for (var i = 1; i <= 6; i++) {
      var p = 'Linked Subject ' + i + ': ';
      out.push(f(p + 'Provider Subject No', 'X', { max: 38 }));
      out.push(f(p + 'Role', 'X', { dom: 'Role' }));
      out.push(f(p + 'Name of the Linked Subject', 'X', { text: 'free' }));
    }
    return out;
  }

  function common(refDateName) {
    return [
      f('Record Type', 'X', { req: 'M' }),
      f('Provider Code', 'X', { req: 'M', max: 8 }),
      f('Branch Code', 'X', { max: 5 }),
      f(refDateName, 'D', { req: 'M', refDate: true }),
      f('Provider Subject No', 'X', { req: 'M', max: 38 })
    ];
  }

  // Fields 1-17 are shared by every contract record.
  function contractHead(typeDom, statusDom) {
    return common('Contract Reference Date').concat([
      f('Role', 'X', { req: 'M', dom: 'Role' }),
      f('Provider Contract No', 'X', { req: 'M' }),
      f('Contract Type', 'X', { req: 'M', dom: typeDom }),
      f('Contract Phase', 'X', { req: 'M', dom: 'ContractPhase' }),
      f('Contract Status', 'X', { dom: statusDom }),
      f('Currency', 'X', { req: 'E', dom: 'Currency' }),
      f('Original Currency', 'X', { req: 'E', dom: 'Currency' }),
      f('Contract Start Date', 'D'),
      f('Contract Request Date', 'D'),
      f('Contract End Planned Date', 'D'),
      f('Contract End Actual Date', 'D'),
      f('Last Payment Date', 'D')
    ]);
  }

  var HD = [
    f('Record Type', 'X', { req: 'M' }),
    f('Provider Code', 'X', { req: 'M', max: 8 }),
    f('File Reference Date', 'D', { req: 'M' }),
    f('Version', 'X', { req: 'M', max: 12 }),
    f('Submission Type', 'X', { req: 'M', max: 1 }),
    f('Provider Comments', 'X', { max: 100 })
  ];

  var ID = common('Subject Reference Date').concat([
    f('Title', 'X', { dom: 'Title' }),
    f('First Name', 'X', { req: 'M', text: 'name' }),
    f('Last Name', 'X', { req: 'M', text: 'name' }),
    f('Middle Name', 'X', { text: 'name' }),
    f('Suffix', 'X', { text: 'name' }),
    f('Nickname', 'X', { text: 'name' }),
    f('Previous Last Name', 'X', { text: 'name' }),
    f('Gender', 'X', { req: 'E', dom: 'Gender' }),
    f('Date of Birth', 'D', { req: 'M' }),
    f('Place of Birth', 'X', { max: 100, text: 'free' }),
    f('Country of Birth (Code)', 'X', { dom: 'Country' }),
    f('Nationality', 'X', { dom: 'Country' }),
    f('Resident', 'X', { dom: 'YesNo' }),
    f('Civil Status', 'X', { dom: 'CivilStatus' }),
    f('Number of Dependents', 'N'),
    f('Car/s Owned', 'N'),
    f('Spouse First Name', 'X', { text: 'name' }),
    f('Spouse Last Name', 'X', { text: 'name' }),
    f('Spouse Middle Name', 'X', { text: 'name' }),
    f("Mother's Maiden First Name", 'X', { text: 'name' }),
    f("Mother's Maiden Full Name", 'X', { text: 'name' }),
    f("Mother's Maiden Middle Name", 'X', { text: 'name' }),
    f('Father First Name', 'X', { text: 'name' }),
    f('Father Last Name', 'X', { text: 'name' }),
    f('Father Middle Name', 'X', { text: 'name' }),
    f('Father Suffix', 'X', { text: 'name' })
  ])
    .concat(address('Address 1', 'AddressTypeIndividual'))
    .concat(address('Address 2', 'AddressTypeIndividual'))
    .concat(pairs('Identification', 3, 'Type', 'Number', 'IdentificationType'))
    .concat(idDocs())
    .concat(pairs('Contact', 2, 'Type', 'Value', 'ContactType'))
    .concat([
      f('Employment: Trade Name', 'X', { text: 'free' }),
      f('Employment: TIN'),
      f('Employment: Phone Number'),
      f('Employment: PSIC', 'X', { dom: 'PSIC' }),
      f('Employment: GrossIncome', 'N'),
      f('Employment: Annual/Monthly Indicator', 'X', { dom: 'AnnualMonthly' }),
      f('Employment: Currency', 'X', { dom: 'Currency' }),
      f('Employment: OccupationStatus', 'X', { dom: 'OccupationStatus' }),
      f('Employment: DateHiredFrom', 'D'),
      f('Employment: DateHiredTo', 'D'),
      f('Employment: Occupation', 'X', { dom: 'PSOC' }),
      f('Sole Trader: TradeName', 'X', { text: 'free' })
    ])
    // The workbook lists MI/AI for individuals and MT/AT for companies and does
    // not say which a sole trader's business address takes, so accept both.
    .concat(address('Sole Trader Address 1', ['AddressTypeIndividual', 'AddressTypeCompany']))
    .concat(address('Sole Trader Address 2', ['AddressTypeIndividual', 'AddressTypeCompany']))
    .concat(pairs('Sole Trader Identification', 2, 'Type', 'Number', 'IdentificationType'))
    .concat(pairs('Sole Trader Contact', 2, 'Type', 'Value', 'ContactType'));

  var BD = common('Subject Reference Date').concat([
    f('Trade Name', 'X', { req: 'M', text: 'free' }),
    f('Official registered Trade Name', 'X', { text: 'free' }),
    f('Nationality', 'X', { dom: 'Country' }),
    f('Resident', 'X', { dom: 'YesNo' }),
    f('Legal Form', 'X', { dom: 'LegalForm' }),
    f('Term of existence'),
    f('PSIC', 'X', { dom: 'PSIC' }),
    f('Registration Date', 'D'),
    f('Number of Employees', 'N'),
    f('Firm Size', 'X', { dom: 'FirmSize' }),
    f('Gross Income / Annual Turnover', 'N'),
    f('Net taxable Income', 'N'),
    f('Monthly Expenses', 'N'),
    f('Currency', 'X', { dom: 'Currency' })
  ])
    .concat(address('Address 1', 'AddressTypeCompany'))
    .concat(address('Address 2', 'AddressTypeCompany'))
    .concat(pairs('Identification', 2, 'Type', 'Number', 'IdentificationType'))
    .concat(pairs('Contact', 2, 'Type', 'Value', 'ContactType'));

  var CI = contractHead('ContractTypeInstallment', 'ContractStatusInstallment').concat([
    f('Reorganized Credit Code', 'X', { dom: 'ReorganizedCredit' }),
    f('Board Resolution flag', 'X', { dom: 'YesNo' }),
    f('Financed Amount', 'N'),
    f('Installments Number', 'N'),
    f('Transaction Type / Sub-facility', 'X', { dom: 'TransactionType' }),
    f('Purpose of credit', 'X', { dom: 'CreditPurpose' }),
    f('Payment Periodicity', 'X', { dom: 'PaymentPeriodicity' }),
    f('Payment Method', 'X', { dom: 'PaymentMethod' }),
    f('Monthly Payment Amount', 'N'),
    f('First Payment Date', 'D'),
    f('Last payment amount', 'N'),
    f('Next Payment Date', 'D'),
    f('Next Payment', 'N'),
    f('Outstanding Payments Number', 'N'),
    f('Outstanding Balance', 'N'),
    f('Overdue Payments Number', 'N'),
    f('Overdue Payments Amount', 'N'),
    f('Overdue Days', 'N', { orDom: 'OverdueDays' }),
    f('Good Type', 'X', { dom: 'GoodType' }),
    f('Good Value', 'N'),
    f('New/Used Code', 'X', { dom: 'NewUsed' }),
    f('Good Brand', 'X', { text: 'free' }),
    f('Manufacturing Date', 'D', { soft: true }),
    f('Registration number')
  ]).concat(guarantees()).concat(linkedSubjects());

  var CN = contractHead('ContractTypeNonInstallment', 'ContractStatusNonInstallment').concat([
    f('Reorganized Credit Code', 'X', { dom: 'ReorganizedCredit' }),
    f('Board Resolution flag', 'X', { dom: 'YesNo' }),
    f('Credit Limit', 'N'),
    f('Transaction Type / Sub-facility', 'X', { dom: 'TransactionType' }),
    f('Purpose of credit', 'X', { dom: 'CreditPurpose' }),
    f('Utilisation / Outstanding Balance', 'N'),
    f('Overdue Payments Amount', 'N'),
    f('Overall Credit Limit', 'N')
  ]).concat(guarantees()).concat(linkedSubjects());

  var CC = contractHead('ContractTypeCreditCard', 'ContractStatusCreditCard').concat([
    f('Reorganized Credit Code', 'X', { dom: 'ReorganizedCredit' }),
    f('Credit limit', 'N'),
    f('Transaction Type / Sub-facility', 'X', { dom: 'TransactionType' }),
    f('Card Reference Number'),
    f('Payment Periodicity', 'X', { dom: 'PaymentPeriodicity' }),
    f('Payment Method', 'X', { dom: 'PaymentMethod' }),
    f('Monthly Payment Amount', 'N'),
    f('Next Payment Date', 'D'),
    f('Next Payment / Minimum Payment Due', 'N'),
    f('Last Payment Amount', 'N'),
    f('Outstanding Balance', 'N'),
    f('Outstanding Balance - Unbilled', 'N'),
    f('Overdue Payments Number', 'N'),
    f('Overdue Payments Amount', 'N'),
    f('Overdue Days', 'N', { orDom: 'OverdueDays' }),
    f('Installment Type', 'X', { dom: 'InstallmentType' }),
    f('Charged / Purchases Amount', 'N'),
    f('Last Charge Date', 'D'),
    f('Flag Card Used', 'X', { dom: 'YesNo' }),
    f('Times Card Used', 'N'),
    f('Min Payment Indicator', 'X', { dom: 'YesNo' }),
    f('Min Payment Percentage', 'N'),
    f('Premium Card', 'X', { dom: 'CardPremium' }),
    f('Cancellation Date', 'D')
  ]).concat(guarantees()).concat(linkedSubjects());

  var CS = contractHead('ContractTypeUtilities', 'ContractStatusUtilities').concat([
    f('Payment Periodicity', 'X', { dom: 'PaymentPeriodicity' }),
    f('Payment Method', 'X', { dom: 'PaymentMethod' }),
    f('Next Payment Date', 'D'),
    f('Next Payment', 'N'),
    f('Billed Amount', 'N'),
    f('Outstanding Balance', 'N'),
    f('Overdue Payments Number', 'N'),
    f('Overdue Payments Amount', 'N'),
    f('Overdue Days', 'N', { orDom: 'OverdueDays' }),
    f('Services/Lines Number', 'N'),
    f('Holder Liability', 'X', { dom: 'LiableFlag' }),
    f('Installment Type', 'X', { dom: 'InstallmentType' })
  ]);

  var NE = common('Negative Event Reference Date').concat([
    f('Event Code', 'X', { req: 'M', dom: 'SubjectInfoType' }),
    f('Event Detail', 'X', { text: 'free' }),
    f('Event Date', 'D', { req: 'E' }),
    f('Event Status', 'X', { dom: 'EventStatus' }),
    f('Event Status Date', 'D')
  ]);

  var SL = [
    f('Record Type', 'X', { req: 'M' }),
    f('Provider Code', 'X', { req: 'M', max: 8 }),
    f('Branch Code', 'X', { max: 5 }),
    f('Subject Link Reference Date', 'D', { req: 'M', refDate: true }),
    f('Provider Subject No (Parent)', 'X', { req: 'M', max: 38 }),
    f('Role of the Parent', 'X', { req: 'M', dom: 'CompanyRole' }),
    f('Provider Subject No (Child)', 'X', { req: 'M', max: 38 })
  ];

  var FT = [
    f('Record Type', 'X', { req: 'M' }),
    f('Provider Code', 'X', { req: 'M', max: 8 }),
    f('File Reference Date', 'D', { req: 'M' }),
    f('No. of records', 'N', { req: 'M' })
  ];

  var RECORDS = {
    HD: { label: 'Header', kind: 'header', fields: HD },
    ID: { label: 'Individual', kind: 'subject', fields: ID },
    BD: { label: 'Business', kind: 'subject', fields: BD },
    SL: { label: 'Subject Link', kind: 'link', fields: SL },
    NE: { label: 'Negative Event', kind: 'negative', fields: NE },
    CI: { label: 'Installment Contract', kind: 'contract', fields: CI },
    CN: { label: 'Non-Installment Contract', kind: 'contract', fields: CN },
    CC: { label: 'Credit Card', kind: 'contract', fields: CC },
    CS: { label: 'Services / Utilities', kind: 'contract', fields: CS },
    FT: { label: 'Footer', kind: 'footer', fields: FT }
  };

  var api = {
    RECORDS: RECORDS,
    ORDER: ['HD', 'ID', 'BD', 'SL', 'NE', 'CI', 'CN', 'CC', 'CS', 'FT'],
    FORMAT_VERSION: '1.0'
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CIC_SPEC = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
