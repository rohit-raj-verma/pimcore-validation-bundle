# PimcoreValidationBundle

A Pimcore bundle that adds complex field validation rules directly in the class definition editor. Define validation constraints like alpha, alphanumeric, numeric, email, phone, regex patterns, length limits, and numeric ranges per field. Validation is enforced when saving data objects.

## Features

- **Class Definition Integration**: Configure validation rules directly in the class editor for each field
- **Multiple Validation Formats**:
  - **Alpha**: Only letters (a-z, A-Z) and spaces allowed
  - **Alphanumeric**: Only letters, numbers, and spaces allowed
  - **Numeric**: Only numeric values allowed
  - **Email**: Valid email address format
  - **Phone**: Valid phone number format
  - **Regex**: Custom regular expression pattern
  - **Length**: Minimum and/or maximum character length
  - **Range**: Minimum and/or maximum numeric value
- **Required Field Validation**: Mark fields as required with custom error messages
- **Custom Error Messages**: Define user-friendly error messages for each validation rule
- **Visual Indicators**: Fields with validation rules display a visual indicator in the object editor
- **Inline Error Display**: Validation errors are shown directly on the field when saving fails

## Requirements

- Pimcore 11.x
- PHP 8.1 or higher

## Installation

### Step 1: Install the Bundle

```bash
composer require vendor/pimcore-validation-bundle
```

Or add the bundle manually to your project's `bundles` directory.

### Step 2: Enable the Bundle

Add the bundle to your `config/bundles.php`:

```php
return [
    // ...
    PimcoreValidationBundle\PimcoreValidationBundle::class => ['all' => true],
];
```

### Step 3: Install the Bundle (Create Database Table)

```bash
bin/console pimcore:bundle:install PimcoreValidationBundle
```

This creates the `pimcore_validation_field_rules` table to store validation configurations.

### Step 4: Clear Cache

```bash
bin/console cache:clear
```

## Usage

### Adding Validation Rules to a Field

1. Navigate to **Settings > Data Objects > Classes** in Pimcore admin
2. Open your class definition (e.g., Product)
3. Select a field in the class tree (e.g., `sku`, `email`, `price`)
4. In the field settings panel, locate the **Validation** fieldset
5. Configure the validation options:
   - **Enable validation**: Turn validation on/off for this field
   - **Required**: Make the field mandatory
   - **Format**: Select the validation type
   - **Error message**: Custom message shown when validation fails
6. Save the class definition

### Validation Format Options

| Format | Description | Additional Options |
|--------|-------------|-------------------|
| None | No validation | - |
| Alpha | Letters only (a-z, A-Z, spaces) | - |
| Alphanumeric | Letters and numbers only | - |
| Numeric | Numeric values only | - |
| Email | Valid email format | - |
| Phone | Valid phone number format | - |
| Regex | Custom regex pattern | Regex pattern (without delimiters) |
| Length | Character length limits | Min length, Max length |
| Range | Numeric value limits | Min value, Max value |

### Examples

#### SKU Field - Alphanumeric Only
```
Format: Alphanumeric
Error message: SKU must contain only letters and numbers
```

#### Email Field - Email Validation
```
Format: Email
Required: Yes
Error message: Please enter a valid email address
```

#### Price Field - Numeric Range
```
Format: Range
Min value: 0
Max value: 99999
Error message: Price must be between 0 and 99999
```

#### Product Code - Regex Pattern
```
Format: Regex
Regex: ^[A-Z]{3}-[0-9]{4}$
Error message: Product code must match format XXX-0000
```

#### Description Field - Length Limits
```
Format: Length
Min length: 10
Max length: 500
Error message: Description must be between 10 and 500 characters
```

## How It Works

1. **Class Definition Save**: When you save a class definition, the bundle intercepts the request and extracts validation configurations for each field, storing them in the `pimcore_validation_field_rules` database table.

2. **Object Save**: When a data object is saved, the bundle listens to the `PRE_UPDATE_VALIDATION_EXCEPTION` event, retrieves the validation rules for the object's class, and validates each field value against its configured rules.

3. **Validation Failure**: If validation fails, a `ValidationException` is thrown with the error message, and the field is marked invalid in the UI with inline error display.

## Database Table

The bundle creates a table `pimcore_validation_field_rules` with the following structure:

| Column | Type | Description |
|--------|------|-------------|
| id | INT | Primary key |
| classId | VARCHAR(64) | Pimcore class ID |
| fieldName | VARCHAR(190) | Field name |
| config | TEXT | JSON-encoded validation configuration |
| modificationDate | INT | Last modification timestamp |

## Uninstallation

To remove the bundle and its database table:

```bash
bin/console pimcore:bundle:uninstall PimcoreValidationBundle
```

## Translations

The bundle includes English translations. To add additional languages, create translation files in `translations/admin.{locale}.yml`:

```yaml
pimcore_validation_title: 'Validation'
pimcore_validation_enable: 'Enable validation'
pimcore_validation_required: 'Required'
pimcore_validation_format: 'Format'
pimcore_validation_format_none: 'None'
pimcore_validation_format_email: 'Email'
pimcore_validation_format_phone: 'Phone'
pimcore_validation_format_regex: 'Regex'
pimcore_validation_format_alpha: 'Alpha'
pimcore_validation_format_alphanumeric: 'Alpha Numeric'
pimcore_validation_format_numeric: 'Numeric'
pimcore_validation_format_length: 'Length'
pimcore_validation_format_range: 'Range'
pimcore_validation_regex: 'Regex (without delimiters)'
pimcore_validation_min_length: 'Min length'
pimcore_validation_max_length: 'Max length'
pimcore_validation_min_value: 'Min value'
pimcore_validation_max_value: 'Max value'
pimcore_validation_message: 'Error message (optional)'
```

## License

This bundle is released under the MIT License.
