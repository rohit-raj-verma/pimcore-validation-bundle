<?php
declare(strict_types=1);

namespace PimcoreValidationBundle\EventSubscriber;

use Pimcore\Event\DataObjectEvents;
use Pimcore\Event\Model\DataObjectEvent;
use Pimcore\Model\DataObject\Concrete;
use Pimcore\Model\Element\ValidationException;
use PimcoreValidationBundle\Repository\FieldValidationRuleRepository;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;

final class ObjectFieldValidationSubscriber implements EventSubscriberInterface
{
    public function __construct(
        private readonly FieldValidationRuleRepository $repository
    ) {
    }

    public static function getSubscribedEvents(): array
    {
        return [
            DataObjectEvents::PRE_UPDATE_VALIDATION_EXCEPTION => 'onPreUpdateValidationException',
        ];
    }

    public function onPreUpdateValidationException(DataObjectEvent $event): void
    {
        $object = $event->getObject();
        if (!$object instanceof Concrete) {
            return;
        }

        $classId = (string) $object->getClassId();
        if ($classId === '') {
            return;
        }

        $rules = $this->repository->getRulesForClass($classId);
        if ($rules === []) {
            return;
        }

        $exceptions = $event->getArgument('validationExceptions') ?? [];
        if (!is_array($exceptions)) {
            $exceptions = [];
        }

        $omitMandatoryCheck = (bool) $object->getOmitMandatoryCheck();

        foreach ($rules as $fieldName => $config) {
            $getter = 'get' . ucfirst($fieldName);
            if (!method_exists($object, $getter)) {
                continue;
            }

            $value = $object->$getter();
            $error = $this->validateValue($value, $config, $omitMandatoryCheck);
            if ($error === null) {
                continue;
            }

            // Mimic Pimcore's convention: append "fieldname=" so the UI can map it to the field.
            $exceptions[] = new ValidationException($error . ' fieldname=' . $fieldName);
        }

        $event->setArgument('validationExceptions', $exceptions);
    }

    /**
     * @param array<string, mixed> $config
     */
    private function validateValue(mixed $value, array $config, bool $omitMandatoryCheck): ?string
    {
        $enabled = (bool) ($config['enabled'] ?? false);
        if (!$enabled) {
            return null;
        }

        $message = trim((string) ($config['message'] ?? ''));
        $format = (string) ($config['format'] ?? 'none');
        $required = (bool) ($config['required'] ?? false);

        if ($required && !$omitMandatoryCheck) {
            if ($this->isEmpty($value)) {
                return $message !== '' ? $message : 'This field is required';
            }
        }

        if ($this->isEmpty($value)) {
            // optional field, nothing to validate
            return null;
        }

        $stringValue = is_scalar($value) ? (string) $value : null;
        $numericValue = is_numeric($value) ? (float) $value : (is_string($value) && is_numeric(trim($value)) ? (float) trim($value) : null);

        // String-based validations
        if (in_array($format, ['email', 'phone', 'regex', 'alpha', 'alphanumeric', 'numeric', 'length'], true)) {
            if ($stringValue === null) {
                return null;
            }

            $stringValue = trim($stringValue);

            if ($format === 'email' && filter_var($stringValue, FILTER_VALIDATE_EMAIL) === false) {
                return $message !== '' ? $message : 'Invalid email address';
            }

            if ($format === 'phone' && !preg_match('/^\\+?[0-9 ()\\-]{6,}$/', $stringValue)) {
                return $message !== '' ? $message : 'Invalid phone number';
            }

            if ($format === 'alpha' && !preg_match('/^[a-zA-Z\\s]+$/', $stringValue)) {
                return $message !== '' ? $message : 'Only letters are allowed';
            }

            if ($format === 'alphanumeric' && !preg_match('/^[a-zA-Z0-9\\s]+$/', $stringValue)) {
                return $message !== '' ? $message : 'Only letters and numbers are allowed';
            }

            if ($format === 'numeric' && !preg_match('/^-?\\d+(?:\\.\\d+)?$/', $stringValue)) {
                return $message !== '' ? $message : 'Only numeric values are allowed';
            }

            if ($format === 'length') {
                $minLength = isset($config['minLength']) ? (int) $config['minLength'] : null;
                $maxLength = isset($config['maxLength']) ? (int) $config['maxLength'] : null;

                $len = function_exists('mb_strlen') ? mb_strlen($stringValue) : strlen($stringValue);
                if ($minLength !== null && $minLength > 0 && $len < $minLength) {
                    return $message !== '' ? $message : sprintf('Minimum length is %d', $minLength);
                }
                if ($maxLength !== null && $maxLength > 0 && $len > $maxLength) {
                    return $message !== '' ? $message : sprintf('Maximum length is %d', $maxLength);
                }
            }

            if ($format === 'regex') {
                $pattern = trim((string) ($config['regex'] ?? ''));
                if ($pattern !== '') {
                    // Expect pattern without delimiters, use #...# like Pimcore's UI hint
                    $ok = @preg_match('#' . $pattern . '#', $stringValue);
                    if ($ok !== 1) {
                        return $message !== '' ? $message : 'Invalid format';
                    }
                }
            }
        }

        // Numeric range validation
        if ($format === 'range') {
            if ($numericValue === null) {
                return $message !== '' ? $message : 'Invalid numeric value';
            }

            $min = isset($config['min']) && $config['min'] !== null && $config['min'] !== '' ? (float) $config['min'] : null;
            $max = isset($config['max']) && $config['max'] !== null && $config['max'] !== '' ? (float) $config['max'] : null;

            if ($min !== null && $numericValue < $min) {
                return $message !== '' ? $message : sprintf('Minimum value is %s', (string) $min);
            }
            if ($max !== null && $numericValue > $max) {
                return $message !== '' ? $message : sprintf('Maximum value is %s', (string) $max);
            }
        }

        return null;
    }

    private function isEmpty(mixed $value): bool
    {
        if ($value === null) {
            return true;
        }

        if (is_string($value)) {
            return trim($value) === '';
        }

        if (is_array($value)) {
            return $value === [];
        }

        return false;
    }
}

