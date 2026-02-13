<?php
declare(strict_types=1);

namespace PimcoreValidationBundle;

use Doctrine\DBAL\Connection;
use Doctrine\DBAL\Exception;
use Doctrine\DBAL\Platforms\AbstractPlatform;
use Doctrine\DBAL\Schema\Comparator;
use Doctrine\DBAL\Schema\Schema;
use Doctrine\DBAL\Schema\SchemaException;
use Pimcore\Extension\Bundle\Installer\Exception\InstallationException;
use Pimcore\Extension\Bundle\Installer\SettingsStoreAwareInstaller;
use Symfony\Component\HttpKernel\Bundle\BundleInterface;

final class Installer extends SettingsStoreAwareInstaller
{
    public const TABLE_NAME = 'pimcore_validation_field_rules';

    public function __construct(
        private readonly Connection $db,
        BundleInterface $bundle
    ) {
        parent::__construct($bundle);
    }

    /**
     * @throws Exception|SchemaException
     */
    public function install(): void
    {
        $schema = $this->db->createSchemaManager()->introspectSchema();
        $this->createRulesTable($schema);
        $this->executeDiffSql($schema);

        parent::install();
    }

    /**
     * @throws Exception|SchemaException
     */
    public function uninstall(): void
    {
        $schema = $this->db->createSchemaManager()->introspectSchema();
        if ($schema->hasTable(self::TABLE_NAME)) {
            $schema->dropTable(self::TABLE_NAME);
        }

        $this->executeDiffSql($schema);

        parent::uninstall();
    }

    /**
     * @throws SchemaException
     */
    private function createRulesTable(Schema $schema): void
    {
        if ($schema->hasTable(self::TABLE_NAME)) {
            return;
        }

        $table = $schema->createTable(self::TABLE_NAME);

        $table->addColumn('id', 'integer', [
            'autoincrement' => true,
            'unsigned' => true,
            'notnull' => true,
        ]);

        $table->addColumn('classId', 'string', [
            'length' => 64,
            'notnull' => true,
        ]);

        $table->addColumn('fieldName', 'string', [
            'length' => 190,
            'notnull' => true,
        ]);

        $table->addColumn('config', 'text', [
            'notnull' => true,
        ]);

        $table->addColumn('modificationDate', 'integer', [
            'unsigned' => true,
            'length' => 11,
            'notnull' => true,
        ]);

        $table->setPrimaryKey(['id'], 'pk_pimcore_validation_rule');
        $table->addUniqueIndex(['classId', 'fieldName'], 'uniq_class_field');
        $table->addIndex(['classId'], 'idx_class');
    }

    /**
     * @throws Exception
     */
    private function executeDiffSql(Schema $newSchema): void
    {
        $currentSchema = $this->db->createSchemaManager()->introspectSchema();
        $schemaComparator = new Comparator($this->db->getDatabasePlatform());
        $schemaDiff = $schemaComparator->compareSchemas($currentSchema, $newSchema);
        $dbPlatform = $this->db->getDatabasePlatform();

        if (!$dbPlatform instanceof AbstractPlatform) {
            throw new InstallationException('Could not get database platform.');
        }

        $sqlStatements = $dbPlatform->getAlterSchemaSQL($schemaDiff);
        if (!empty($sqlStatements)) {
            $this->db->executeStatement(implode(';', $sqlStatements));
        }
    }
}

