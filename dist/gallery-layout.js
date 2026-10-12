export function createGalleryLayout(records, saved = {}) {
  const ids = new Set(records.map((record) => record.id));
  const order = [
    ...new Set([
      ...(Array.isArray(saved?.order) ? saved.order : []),
      ...records.map((record) => record.id),
    ]),
  ].filter((id) => ids.has(id));
  const assigned = new Set();
  const stacks = (Array.isArray(saved?.stacks) ? saved.stacks : [])
    .filter(
      (s) =>
        s && typeof s.id === 'string' && typeof s.name === 'string' && Array.isArray(s.members),
    )
    .map((stack) => ({
      id: stack.id,
      name: stack.name.slice(0, 80),
      members: stack.members.filter((id) => {
        if (!ids.has(id) || assigned.has(id)) return false;
        assigned.add(id);
        return true;
      }),
    }))
    .filter((s) => s.members.length);
  const prune = () => {
    for (let i = stacks.length - 1; i >= 0; i--) if (!stacks[i].members.length) stacks.splice(i, 1);
  };
  const unstack = (members) => {
    for (const stack of stacks) stack.members = stack.members.filter((id) => !members.includes(id));
    prune();
  };
  return {
    state: { version: 1, order, stacks },
    stack(members, name, id) {
      const valid = [...new Set(members)].filter((item) => ids.has(item));
      if (!valid.length) return;
      unstack(valid);
      stacks.push({ id, name: name.trim().slice(0, 80) || '堆叠', members: valid });
    },
    unstack,
    moveToStack(members, target) {
      const stack = stacks.find((s) => s.id === target);
      if (!stack) return;
      const valid = members.filter((id) => ids.has(id) && !stack.members.includes(id));
      for (const other of stacks)
        if (other !== stack) other.members = other.members.filter((id) => !valid.includes(id));
      stack.members.push(...valid);
      prune();
    },
    reorder(id, target) {
      const from = order.indexOf(id),
        to = order.indexOf(target);
      if (from < 0 || to < 0 || from === to) return;
      order.splice(from, 1);
      order.splice(to, 0, id);
    },
  };
}
