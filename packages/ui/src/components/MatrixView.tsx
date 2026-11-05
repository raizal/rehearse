// Box `review/matrix` (S7-A1): roles × entities, the actions in each cell, and a link
// from each action to the boxes that give it. A link opens the box in the flow view.

import type { EntityModel, Flow, PermissionBoxes, PermissionMatrix, Prd } from '@rehearse/core';
import { matrixAxes } from '../model/review.js';

export interface MatrixViewProps {
  simulation?: { permissionMatrix: PermissionMatrix; permissionBoxes: PermissionBoxes };
  flow?: Flow;
  prd?: Prd;
  entities?: EntityModel;
  onOpenBox: (path: string) => void;
}

export function MatrixView({ simulation, flow, prd, entities, onOpenBox }: MatrixViewProps) {
  if (!simulation) {
    return (
      <section className="page" data-testid="matrix-view">
        <h2>Permission matrix</h2>
        <p className="muted" data-testid="matrix-missing">The server sent no simulation. Run simulate, or update rehearse serve.</p>
      </section>
    );
  }
  const { permissionMatrix: matrix, permissionBoxes: boxes } = simulation;
  const entityNames = Array.isArray(entities?.entities) ? entities.entities.map((e) => e.id) : [];
  const { roles, entities: cols } = matrixAxes(matrix, flow, entityNames);
  const roleName = (id: string) => (Array.isArray(prd?.roles) ? prd.roles.find((r) => r.id === id)?.name : undefined) ?? id;

  return (
    <section className="page" data-testid="matrix-view">
      <h2>Permission matrix</h2>
      <p className="muted">
        What each role can do to each entity, from the reads and writes of the boxes in its lane. A transition is also a write.
        Click a box to open it in the flow view.
      </p>
      {roles.length === 0 ? (
        <p className="muted" data-testid="matrix-empty">No box reads or writes an entity.</p>
      ) : (
        <div className="table-wrap">
          <table className="matrix" data-testid="matrix-table">
            <caption className="sr-only">Permission matrix: roles in rows, entities in columns</caption>
            <thead>
              <tr>
                <th scope="col">Role \ Entity</th>
                {cols.map((e) => (
                  <th scope="col" key={e} data-testid={`matrix-entity-${e}`}>
                    {e}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role}>
                  <th scope="row" data-testid={`matrix-role-${role}`}>
                    {roleName(role)}
                    {roleName(role) !== role && <span className="muted small"> {role}</span>}
                  </th>
                  {cols.map((entity) => {
                    const actions = matrix[role]?.[entity] ?? [];
                    const byAction = boxes[role]?.[entity] ?? {};
                    return (
                      <td key={entity} data-testid={`matrix-cell-${role}-${entity}`} className={actions.length ? 'has-access' : 'no-access'}>
                        {actions.length === 0 ? (
                          <span className="muted">no access</span>
                        ) : (
                          <ul className="cell-actions">
                            {actions.map((action) => (
                              <li key={action} data-testid={`matrix-action-${role}-${entity}-${action}`}>
                                <span className={`action-name action-${action}`}>{action}</span>
                                {(byAction[action as keyof typeof byAction] ?? []).map((path) => (
                                  <button
                                    key={path}
                                    type="button"
                                    className="box-link"
                                    data-testid={`matrix-box-${role}-${entity}-${action}-${path}`}
                                    aria-label={`Open box ${path} (${role} can ${action} ${entity})`}
                                    onClick={() => onOpenBox(path)}
                                  >
                                    {path}
                                  </button>
                                ))}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
