<?php
declare(strict_types=1);

namespace PimcoreValidationBundle\Repository;

use Doctrine\DBAL\Connection;
use PimcoreValidationBundle\Installer;

final class FieldValidationRuleRepository
{
    public function __construct(
        private readonly Connection $db
    ) {
    }

    /**
     * @param array<string, array<string, mixed>> $rulesByFieldName
     */
    public function replaceRulesForClass(string $classId, array $rulesByFieldName): void
    {
        $this->db->beginTransaction();
        try {
            $this->db->executeStatement(
                'DELETE FROM ' . Installer::TABLE_NAME . ' WHERE classId = ?',
                [$classId]
            );

            $now = time();
            foreach ($rulesByFieldName as $fieldName => $config) {
                $this->db->insert(Installer::TABLE_NAME, [
                    'classId' => $classId,
                    'fieldName' => $fieldName,
                    'config' => json_encode($config, JSON_THROW_ON_ERROR),
                    'modificationDate' => $now,
                ]);
            }

            $this->db->commit();
        } catch (\Throwable $e) {
            $this->db->rollBack();
            throw $e;
        }
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    public function getRulesForClass(string $classId): array
    {
        $rows = $this->db->fetchAllAssociative(
            'SELECT fieldName, config FROM ' . Installer::TABLE_NAME . ' WHERE classId = ?',
            [$classId]
        );

        $result = [];
        foreach ($rows as $row) {
            $result[(string) $row['fieldName']] = json_decode((string) $row['config'], true, 512, JSON_THROW_ON_ERROR);
        }

        return $result;
    }
}

