import lodash from 'lodash';

export function pick(obj: object): unknown {
  return lodash.get(obj, 'a');
}
