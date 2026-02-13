<?php
declare(strict_types=1);

namespace PimcoreValidationBundle\Controller\Admin;

use Pimcore\Bundle\AdminBundle\Controller\AdminAbstractController;
use PimcoreValidationBundle\Repository\FieldValidationRuleRepository;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

final class RulesController extends AdminAbstractController
{
    public function __construct(
        private readonly FieldValidationRuleRepository $repository
    ) {
    }

    public function rulesAction(Request $request): JsonResponse
    {
        $classId = (string) $request->query->get('classId', '');
        if ($classId === '') {
            return $this->adminJson([
                'success' => false,
                'message' => 'Missing classId',
            ], 400);
        }

        return $this->adminJson([
            'success' => true,
            'rules' => $this->repository->getRulesForClass($classId),
        ]);
    }
}

