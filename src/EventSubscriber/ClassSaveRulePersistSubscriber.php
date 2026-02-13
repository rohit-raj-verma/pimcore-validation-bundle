<?php
declare(strict_types=1);

namespace PimcoreValidationBundle\EventSubscriber;

use PimcoreValidationBundle\Repository\FieldValidationRuleRepository;
use Symfony\Component\EventDispatcher\EventSubscriberInterface;
use Symfony\Component\HttpKernel\Event\ControllerEvent;
use Symfony\Component\HttpKernel\KernelEvents;

/**
 * Persists per-field validation rules from the class editor save request.
 *
 * Pimcore does not persist unknown per-field properties into PHP field definition objects.
 * Therefore we extract our `pimcoreValidation` config from the raw `configuration` JSON request.
 */
final class ClassSaveRulePersistSubscriber implements EventSubscriberInterface
{
    public function __construct(
        private readonly FieldValidationRuleRepository $repository
    ) {
    }

    public static function getSubscribedEvents(): array
    {
        // Run before controller action executes and before Pimcore discards unknown keys
        return [
            KernelEvents::CONTROLLER => ['onKernelController', 100],
        ];
    }

    public function onKernelController(ControllerEvent $event): void
    {
        $request = $event->getRequest();

        // Only handle class save endpoint
        $routeName = $request->attributes->get('_route');
        if ($routeName !== 'pimcore_admin_dataobject_class_save') {
            return;
        }

        $classId = (string) $request->get('id');
        if ($classId === '') {
            return;
        }

        $configurationJson = $request->get('configuration');
        if (!is_string($configurationJson) || $configurationJson === '') {
            return;
        }

        $configuration = json_decode($configurationJson, true);
        if (!is_array($configuration)) {
            return;
        }

        $rulesByField = [];
        $this->collectRulesFromLayoutNode($configuration, $rulesByField);

        // Only persist when our payload exists; otherwise we still clear rules for the class to avoid stale config.
        $this->repository->replaceRulesForClass($classId, $rulesByField);
    }

    /**
     * @param array<string, mixed> $node
     * @param array<string, array<string, mixed>> $rulesByField
     */
    private function collectRulesFromLayoutNode(array $node, array &$rulesByField): void
    {
        // Field nodes are datatype=data
        if (($node['datatype'] ?? null) === 'data' && is_string($node['name'] ?? null)) {
            $fieldName = (string) $node['name'];
            $validation = $node['pimcoreValidation'] ?? null;
            if (is_array($validation)) {
                // Persist the config even if disabled so it survives a class editor reload.
                // Actual enforcement is controlled by the "enabled" flag during object save.
                $rulesByField[$fieldName] = $validation;
            }
        }

        $children = $node['children'] ?? null;
        if (is_array($children)) {
            foreach ($children as $child) {
                if (is_array($child)) {
                    $this->collectRulesFromLayoutNode($child, $rulesByField);
                }
            }
        }
    }
}

