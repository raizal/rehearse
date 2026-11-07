// Find diagrams and boxes by path, and the lanes a diagram shows (R9). The code lives in core
// (`@rehearse/core/layout`) so the deck (T52) draws the same lanes.

export {
  boxAt,
  breadcrumb,
  diagramAt,
  hasChildren,
  laneColor,
  lanesFor,
  LANE_COLORS,
  parentPath,
  roleName,
  UNKNOWN_LANE_COLOR,
  type Crumb,
  type LaneInfo,
} from '@rehearse/core/layout';
