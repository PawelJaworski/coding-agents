// GENERATE_READ_MODELS emitters: the read model record and its projection.
//
// Three shapes, decided by the model:
//   <aggregate>:Id      on-demand projection — a projector rebuilt per query
//   <aggregate>:Key     persisting projection, SINGLE record — entity,
//                       repository and a PersistingProjector that keeps one row
//                       per aggregate up to date; read back by aggregate id
//   <aggregate>:RowKey  persisting projection, ROW LIST — same machinery,
//                       queried as a list of rows (across aggregates, with search)
// Projectors and persisting projectors are hand-owned logic (scaffolded once),
// so their private decision method holds field-by-field event -> row mapping.

import naming from '../../model/naming.js';
import {
  SCAFFOLD_VERSION,
  importBlock,
  components,
  collaborator,
  fieldDeclarations,
  constructorArgs,
  collaboratorImports,
  resolveArg,
} from '../../emit-kit/index.js';

export function readModel(rm) {
  const imports = importBlock(rm.fields.flatMap((f) => f.imports));
  return {
    package: rm.package,
    className: rm.className,
    overwrite: true,
    content: `package ${rm.package};

${imports ? imports + '\n\n' : ''}public record ${rm.className}(${components(rm.fields)}) {
}
`,
  };
}

export function projector(rm, eventsById, ctx) {
  const base = ctx.basePackage;
  const extraImports = [];

  const eventStream = collaborator({
    fieldName: 'eventStream',
    className: 'EventStream',
    testInstantiation: 'EventStreamAbility.INSTANCE',
    imports: [`${base}.eventstream.EventStream`],
  });
  const aggregateIdSequence = collaborator({
    fieldName: 'aggregateIdSequence',
    className: 'AggregateIdSequence',
    testInstantiation: 'AggregateIdSequenceAbility.INSTANCE',
    imports: [`${base}.infrastructure.AggregateIdSequence`],
  });
  const decider = collaborator({
    fieldName: 'decider',
    className: rm.deciderClassName,
    testInstantiation: `new ${rm.deciderClassName}()`,
    scaffold: () => projectionDecider(rm, eventsById, base),
  });

  let delegated = false;
  const applies = rm.subscribes.map((eid) => {
    const e = eventsById.get(eid);
    const args = rm.fields.map((f) => {
      const r = resolveArg(f, {
        sourceFields: e.fields,
        sourceExpr: 'event',
        delegate: { ...decider, args: 'state, event' },
        fallback: (field) => `state == null ? null : state.${field.name}()`,
      });
      if (r.delegated) delegated = true;
      extraImports.push(...r.imports);
      return r.expr;
    });
    extraImports.push(`${e.package}.${e.className}`);
    return `    @Override
    public ${rm.className} apply(${rm.className} state, ${e.className} event) {
        return new ${rm.className}(
${args.map((a) => `                ${a}`).join(',\n')});
    }`;
  });

  const collaborators = delegated ? [eventStream, decider] : [eventStream];

  const imports = importBlock([
    'lombok.RequiredArgsConstructor',
    'org.springframework.stereotype.Component',
    'org.springframework.web.bind.annotation.GetMapping',
    'org.springframework.web.bind.annotation.PathVariable',
    'org.springframework.web.bind.annotation.RestController',
    `${base}.eventstream.StateProjector`,
    ...collaboratorImports(collaborators),
    ...extraImports,
  ]);

  return {
    package: rm.package,
    className: rm.projectorClassName,
    overwrite: true,
    logic: true,
    collaborators,
    content: `package ${rm.package};

${imports}

@RestController
@Component
@RequiredArgsConstructor
public class ${rm.projectorClassName} implements StateProjector<${rm.className}> {

${fieldDeclarations(collaborators)}

    @GetMapping("${rm.getMapping}")
    public ${rm.className} ${rm.getterMethod}(@PathVariable Long aggregateId) {
        return hydrate(null, eventStream.findAllById(aggregateId));
    }

${applies.join('\n\n')}
}
`,
  };
}

export function projectionDecider(rm, eventsById, ctx) {
  const base = ctx.basePackage;
  const methods = [];
  const imports = ['org.springframework.stereotype.Component'];
  // A degraded key (unmappableKey) emits a `key(state, event)` stub below. If a
  // regular field of the SAME name is also marked unmappable (a model like
  // `* product code` + `productCode:Key`), both loops would emit the identical
  // signature — skip the field stub so the key stub is the single implementation.
  const unmappableKeyNames = new Set((rm.keyFields || []).filter((f) => f.unmappableKey).map((f) => f.name));
  // An unresolvable/structured key (parse.js marked it `unmappableKey`) can't be
  // derived automatically, so the projector delegates it to the decider exactly
  // like an unmappable field. Two overloads: the apply() path passes the concrete
  // event (state, event), while project(DomainEvent) only has the generic
  // interface — a stub that throws the same message until hand-implemented.
  for (const f of rm.keyFields || []) {
    if (!f.unmappableKey) continue;
    imports.push(`${base}.eventstream.DomainEvent`, ...(f.imports || []));
    for (const eid of rm.subscribes) {
      const e = eventsById.get(eid);
      imports.push(`${e.package}.${e.className}`);
      methods.push(`    public ${f.javaType} ${f.name}(${rm.className} state, ${e.className} event) {
        throw new UnsupportedOperationException(
                "Key attribute '${f.label}:Key' on read model '${rm.id}' matches no declared field's " +
                "value-object attribute. Add a \\"* <value-object field>\\" whose value object has the " +
                "named attribute, or fix the name, then implement this method by hand.");
    }`);
      methods.push(`    public ${f.javaType} ${f.name}(DomainEvent event) {
        throw new UnsupportedOperationException(
                "Key attribute '${f.label}:Key' on read model '${rm.id}' matches no declared field's " +
                "value-object attribute. Add a \\"* <value-object field>\\" whose value object has the " +
                "named attribute, or fix the name, then implement this method by hand.");
    }`);
    }
  }
  for (const eid of rm.subscribes) {
    const e = eventsById.get(eid);
    for (const f of rm.fields.filter((x) => x.bracketed && !x.convention)) {
      imports.push(...f.imports, `${e.package}.${e.className}`);
      methods.push(`    public ${f.javaType} ${f.name}(${rm.className} state, ${e.className} event) {
        throw new UnsupportedOperationException(
                "[${f.label}] on read model '${rm.id}' is a projection decision with no GWT scenario yet");
    }`);
    }
    for (const f of rm.fields.filter((x) => x.unmappable && !unmappableKeyNames.has(x.name))) {
      imports.push(...f.imports, `${e.package}.${e.className}`);
      methods.push(`    public ${f.javaType} ${f.name}(${rm.className} state, ${e.className} event) {
        throw new UnsupportedOperationException(
                "Unsupported structured-field mapping: ${f.unmappable.reason}. Add a more detailed " +
                "mapping prompt, then implement this method by hand.");
    }`);
    }
  }
  // A "??" (search-only) criterion has no stored value, no event to project it
  // from — its match logic is a pure business decision over the already-persisted
  // read model, applied by the projector AFTER the repository query returns (see
  // persistingProjector), never a DB column/Specification predicate.
  for (const f of rm.searchOnlyFields || []) {
    methods.push(`    public boolean matches${naming.cap(f.name)}(String value, ${rm.className} entity) {
        throw new UnsupportedOperationException(
                "\\"${f.label}??\\" on read model '${rm.id}' is a search criterion with no implementation yet");
    }`);
  }
  return {
    package: rm.package,
    className: rm.deciderClassName,
    once: true,
    version: SCAFFOLD_VERSION,
    content: `package ${rm.package};

${importBlock(imports)}

@Component
public class ${rm.deciderClassName} {

${methods.join('\n\n')}
}
`,
  };
}

export function projectorAbility(rm, ctx, collaborators) {
  const base = ctx.basePackage;
  return {
    test: true,
    package: rm.package,
    className: rm.abilityClassName,
    overwrite: true,
    content: `package ${rm.package};

${importBlock([
  'java.util.function.Predicate',
  `${base}.eventstream.EventStreamAbility`,
])}

public interface ${rm.abilityClassName} extends EventStreamAbility {

    ${rm.projectorClassName} INSTANCE =
            new ${rm.projectorClassName}(${constructorArgs(collaborators)});

    default ${rm.projectorClassName} get${rm.projectorClassName}() {
        return ${rm.abilityClassName}.INSTANCE;
    }

    default boolean ${rm.dslMethod}(Long aggregateId, Predicate<${rm.className}> testCase) {
        return testCase.test(get${rm.projectorClassName}().${rm.getterMethod}(aggregateId));
    }
}
`,
  };
}

// --- persisting read models (<aggregate>:Key / <aggregate>:RowKey) -----------
// JPA row(s), advanced on append. A ":RowKey" model is listable across
// aggregates (which is the whole reason the model marks it with ":RowKey"); a
// ":Key" model serves exactly one record per aggregate, looked up by its id.

export function readModelEntity(rm) {
  const compositeKey = rm.keyFields.length > 0;
  const keyNames = new Set(rm.keyFields.map((f) => f.name));
  const nonKeyFields = rm.fields.filter((f) => !keyNames.has(f.name));
  // A value object with a list attribute cannot be a JPA embeddable and is stored as
  // JSON; a scalar-only value object is embedded and flattened into prefixed columns.
  const jsonFields = nonKeyFields.filter((f) => (f.valueObject && !f.embeds) || f.list || f.children?.length);
  const importBlockList = [
    ...(compositeKey ? ['jakarta.persistence.EmbeddedId'] : ['jakarta.persistence.Id']),
    'jakarta.persistence.AttributeOverride',
    'jakarta.persistence.AttributeOverrides',
    'jakarta.persistence.Column',
    'jakarta.persistence.Embedded',
    'jakarta.persistence.Entity',
    'jakarta.persistence.Table',
    'lombok.AccessLevel',
    'lombok.AllArgsConstructor',
    'lombok.Getter',
    'lombok.NoArgsConstructor',
    'lombok.Setter',
    ...(jsonFields.length
      ? ['org.hibernate.annotations.JdbcTypeCode', 'org.hibernate.type.SqlTypes']
      : []),
    ...nonKeyFields.flatMap((f) => f.imports),
  ];
  const idField = compositeKey
    ? `
    @EmbeddedId
    private ${rm.idClassName} id;
`
    : `
    @Id
    private Long aggregateId;
`;
  const columns = nonKeyFields
    .map((f) => {
      if (f.embeds) {
        const prefix = naming.snake(f.name);
        const overrides = f.attrs
          .map(
            (a) =>
              `        @AttributeOverride(name = "${a.name}", ` +
              `column = @Column(name = "${prefix}_${naming.snake(a.name)}"))`,
          )
          .join(',\n');
        return `    @Embedded\n    @AttributeOverrides({\n${overrides}\n    })\n    private ${f.javaType} ${f.name};`;
      }
      if (f.valueObject || f.list || f.children?.length) {
        return `    @JdbcTypeCode(SqlTypes.JSON)\n    private ${f.javaType} ${f.name};`;
      }
      return `    private ${f.javaType} ${f.name};`;
    })
    .join('\n');
  // toReadModel passes fields in READ MODEL order: key fields come from id.<field>(),
  // everything else from the entity's own fields.
  const readModelArgs = rm.fields.map((f) => (compositeKey && keyNames.has(f.name) ? `id.${f.name}()` : f.name));
  return {
    package: rm.package,
    className: rm.entityClassName,
    overwrite: true,
    logic: true,
    content: `package ${rm.package};

${importBlock(importBlockList)}

@Entity
@Table(name = "${rm.tableName}")
@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ${rm.entityClassName} {
${idField}
${columns}

    public ${rm.className} toReadModel() {
        return new ${rm.className}(${readModelArgs.join(', ')});
    }
}
`,
  };
}

// Composite (natural) id of a persisting read model whose `:Key` fields compose it.
// Only emitted when the model actually marks one or more fields `:Key`; otherwise the
// entity stays keyed by the aggregate id.
export function readModelKey(rm) {
  const components = rm.keyFields
    .map((f) =>
      f.embeds
        ? keyRecordComponent(f)
        : f.derivedFrom
          ? derivedKeyRecordComponent(f)
          : `    ${f.javaType} ${f.name}`,
    )
    .join(',\n');
  return {
    package: rm.package,
    className: rm.idClassName,
    overwrite: true,
    content: `package ${rm.package};

${importBlock(keyRecordImports(rm))}

@Embeddable
public record ${rm.idClassName}(
${components}) {
}
`,
  };
}

function keyRecordComponent(f) {
  const prefix = naming.snake(f.name);
  const overrides = f.attrs
    .map(
      (a) =>
        `            @AttributeOverride(name = "${a.name}", ` +
        `column = @Column(name = "${prefix}_${naming.snake(a.name)}"))`,
    )
    .join(',\n');
  // A record component cannot carry an access modifier (`private` is illegal here) —
  // only the field-declaration form used for plain scalar components allows one.
  return `    @Embedded
    @AttributeOverrides({
${overrides}
    })
    ${f.javaType} ${f.name}`;
}

// A key attribute DERIVED from one specific attribute of a value-object field
// (e.g. "policyHolderName" reading only `.name()` off a "policy holder" field)
// needs an explicit, disambiguated column name: the source field may ALSO be
// kept, undecomposed, as its own plain (non-key) column elsewhere on the same
// entity (to still display the whole value object) — and that column already
// claims the "natural" name (e.g. "policy_holder_name" via that field's own
// @AttributeOverride). A bare column name here would collide with it.
function derivedKeyRecordComponent(f) {
  return `    @Column(name = "${naming.snake(f.name)}_key")\n    ${f.javaType} ${f.name}`;
}

function keyRecordImports(rm) {
  const set = new Set(['jakarta.persistence.Embeddable']);
  let hasEmbeddedStyle = false;
  let hasDerived = false;
  for (const f of rm.keyFields) {
    // Scalar members need their type imports too (a Long identity is not String).
    for (const i of f.imports) set.add(i);
    if (f.embeds) hasEmbeddedStyle = true;
    if (f.derivedFrom) hasDerived = true;
  }
  if (hasEmbeddedStyle) {
    set.add('jakarta.persistence.AttributeOverride');
    set.add('jakarta.persistence.AttributeOverrides');
    set.add('jakarta.persistence.Column');
    set.add('jakarta.persistence.Embedded');
  }
  if (hasDerived) set.add('jakarta.persistence.Column');
  return [...set];
}


// Every searchable field of a persisting read model, as the shared vocabulary the
// server-side repository search and its test double both speak. A scalar String field
// is searchable by its own name (policyNumber); an embedded (scalar-only) value object
// field searches per attribute (policyHolder.name). A value object carrying a list is
// JSON, not embeddable, and is not searchable by an individual element.
function searchableFields(rm) {
  const out = [];
  // A :Key field is a component of the @EmbeddedId, not a root column, so it is
  // not a valid search path (`root.get(...)` would fail at query time).
  for (const f of rm.fields.filter((field) => field.searchable && !field.key)) {
    if (f.embeds) {
      const owner = `e.get${naming.cap(f.name)}()`;
      for (const a of f.attrs) {
        out.push({
          key: `${f.name}.${a.name}`,
          criteriaPath: `root.get("${f.name}").get("${a.name}")`,
          ownerGetter: owner,
          ownerNullGuard: `${owner} == null || `,
          // Record embeddables are accessed by their component name, e.g. .name()
          attrAccessor: `.${a.name}()`,
        });
      }
    } else if (!f.valueObject && !f.list && !f.children?.length) {
      out.push({
        key: f.name,
        criteriaPath: `root.get("${f.name}")`,
        ownerGetter: `e.get${naming.cap(f.name)}()`,
        ownerNullGuard: '',
        attrAccessor: '',
      });
    }
  }
  return out;
}

export function readModelRepository(rm) {
  const compositeKey = rm.keyFields.length > 0;
  const idType = compositeKey ? rm.idClassName : 'Long';
  const repoImports = ['java.util.List', 'java.util.Map', 'java.util.Optional'];
  return {
    package: rm.package,
    className: rm.repositoryClassName,
    overwrite: true,
    logic: true,
    content: `package ${rm.package};

${importBlock(repoImports)}

public interface ${rm.repositoryClassName} {
    ${rm.entityClassName} save(${rm.entityClassName} entity);
    Optional<${rm.entityClassName}> findById(${idType} id);
    List<${rm.entityClassName}> findAll();
    List<${rm.entityClassName}> findAllBySearch(Map<String, String> search);
    void deleteAll();
}
`,
  };
}

export function readModelJpaRepository(rm) {
  const compositeKey = rm.keyFields.length > 0;
  const idType = compositeKey ? rm.idClassName : 'Long';
  const searchables = searchableFields(rm);
  const specImports = searchables.length
    ? [
        'java.util.ArrayList',
        'jakarta.persistence.criteria.Predicate',
        'org.springframework.data.jpa.domain.Specification',
        'org.springframework.data.jpa.repository.JpaSpecificationExecutor',
      ]
    : [];
  const specSearch = searchables
    .map(
      (s) =>
        `            if (search.get("${s.key}") != null && !search.get("${s.key}").isBlank()) {\n` +
        `                predicates.add(cb.like(cb.lower(${s.criteriaPath}), "%" + search.get("${s.key}").toLowerCase() + "%"));\n` +
        `            }`,
    )
    .join('\n');
  return {
    package: rm.package,
    className: rm.jpaRepositoryClassName,
    overwrite: true,
    logic: true,
    content: `package ${rm.package};

${importBlock(['java.util.List', 'java.util.Map', 'org.springframework.data.jpa.repository.JpaRepository', ...specImports])}

public interface ${rm.jpaRepositoryClassName}
        extends ${rm.repositoryClassName},
                JpaRepository<${rm.entityClassName}, ${idType}>${searchables.length ? ',\n                JpaSpecificationExecutor<' + rm.entityClassName + '>' : ''} {

    @Override
    default List<${rm.entityClassName}> findAllBySearch(Map<String, String> search) {
${searchables.length ? `        Specification<${rm.entityClassName}> spec = (root, query, cb) -> {
            var predicates = new ArrayList<Predicate>();
${specSearch}
            return cb.and(predicates.toArray(new Predicate[0]));
        };
        return findAll(spec);` : '        return findAll();'}
    }
}`,
  };
}

export function readModelInMemoryRepository(rm) {
  const compositeKey = rm.keyFields.length > 0;
  const idType = compositeKey ? rm.idClassName : 'Long';
  const idExpr = compositeKey ? 'entity.getId()' : 'entity.getAggregateId()';
  const searchables = searchableFields(rm);
  const cases = searchables
    .map(
      (s) =>
        `                case "${s.key}" -> {
                    if (value.isBlank() || ${s.ownerNullGuard}${s.ownerGetter}${s.attrAccessor} == null
                            || !${s.ownerGetter}${s.attrAccessor}.toLowerCase().contains(value.toLowerCase())) {
                        return false;
                    }
                }`,
    )
    .join('\n');
  const search = searchables.length
    ? `
    @Override
    public List<${rm.entityClassName}> findAllBySearch(Map<String, String> search) {
        return entities.values().stream().filter(e -> {
            for (var entry : search.entrySet()) {
                String value = entry.getValue() == null ? "" : entry.getValue();
                switch (entry.getKey()) {
${cases}
                }
            }
            return true;
        }).toList();
    }`
    : `
    @Override
    public List<${rm.entityClassName}> findAllBySearch(Map<String, String> search) {
        return findAll();
    }`;
  return {
    test: true,
    package: rm.package,
    className: rm.inMemoryRepositoryClassName,
    overwrite: true,
    logic: true,
    content: `package ${rm.package};

${importBlock([
  'java.util.LinkedHashMap',
  'java.util.List',
  'java.util.Map',
  'java.util.Optional',
])}

public class ${rm.inMemoryRepositoryClassName} implements ${rm.repositoryClassName} {

    private final Map<${idType}, ${rm.entityClassName}> entities = new LinkedHashMap<>();

    @Override
    public ${rm.entityClassName} save(${rm.entityClassName} entity) {
        entities.put(${idExpr}, entity);
        return entity;
    }

    @Override
    public Optional<${rm.entityClassName}> findById(${idType} id) {
        return Optional.ofNullable(entities.get(id));
    }

    @Override
    public List<${rm.entityClassName}> findAll() {
        return List.copyOf(entities.values());
    }
${search}
    @Override
    public void deleteAll() {
        entities.clear();
    }
}
`,
  };
}


export function persistingProjector(rm, eventsById, ctx) {
  const base = ctx.basePackage;
  const extraImports = [];
  const compositeKey = rm.keyFields.length > 0;
  const keyNames = new Set(rm.keyFields.map((f) => f.name));

  // The repository is a collaborator like any other — note its
  // testInstantiation is a shared registered static, not `new ...()`. Before
  // collaborators were a list, this difference forced it to be special-cased
  // separately from the decider in every emitter.
  const repository = collaborator({
    fieldName: 'repository',
    className: rm.repositoryClassName,
    testInstantiation: `${rm.abilityClassName}.${rm.repositoryConstant}`,
  });
  const decider = collaborator({
    fieldName: 'decider',
    className: rm.deciderClassName,
    testInstantiation: `new ${rm.deciderClassName}()`,
    scaffold: () => projectionDecider(rm, eventsById, base),
  });

  let delegated = false;
  // An unresolvable/structured key delegates to the decider like any unmappable
  // field — the decider collaborator must be wired even when no regular field ever
  // delegates a projected VALUE to it.
  if (rm.keyFields.some((f) => f.unmappableKey)) delegated = true;
  const applies = rm.subscribes.map((eid) => {
    const e = eventsById.get(eid);
    const args = rm.fields.map((f) => {
      const r = resolveArg(f, {
        sourceFields: e.fields,
        sourceExpr: 'event',
        delegate: { ...decider, args: 'state, event' },
        fallback: (field) => `state == null ? null : state.${field.name}()`,
      });
      if (r.delegated) delegated = true;
      extraImports.push(...r.imports);
      return r.expr;
    });
    extraImports.push(`${e.package}.${e.className}`);

    // For composite-keyed read models, build the composite key from projected key fields.
    // A derived field (one attribute carved out of a value-object field, e.g.
    // "policyHolderName") has no accessor of its own on the projected record —
    // it was never added as one of its components — so it reads through the
    // owning field instead: `projected.policyHolder().name()`. An unresolvable
    // key delegates to the decider, which throws until hand-implemented.
    const projectedKeyArg = (f) => {
      if (f.unmappableKey) return `decider.${f.name}(state, event)`;
      return f.derivedFrom ? `projected.${f.derivedFrom.field}().${f.derivedFrom.attr}()` : `projected.${f.name}()`;
    };
    const entitySave = compositeKey
      ? `repository.save(new ${rm.entityClassName}(new ${rm.idClassName}(${rm.keyFields.map(projectedKeyArg).join(', ')}), ${rm.fields.filter((f) => !keyNames.has(f.name)).map((f) => `projected.${f.name}()`).join(', ')}));`
      : `repository.save(new ${rm.entityClassName}(event.aggregateId(), ${rm.fields.map((f) => `projected.${f.name}()`).join(', ')}));`;

    return `    public ${rm.className} apply(${rm.className} state, ${e.className} event) {
        var projected = new ${rm.className}(
${args.map((a) => `                ${a}`).join(',\n')});
        ${entitySave}
        return projected;
    }`;
  });

  // project(DomainEvent event) receives the GENERIC interface — only members of
  // DomainEvent itself (aggregateId()) are callable on `event` there. A
  // persisting projector maps ONE event to ONE row and never rebuilds stream
  // state, so dispatch pattern-matches the concrete event class instead of
  // going through StateProjector.hydrate(). Each subscribed event gets its own
  // case: build the composite key from the concrete event's fields (identity ->
  // aggregate id, unresolvable -> decider, derived -> through the owning
  // value-object field), look the row up, then hand it to the single-event
  // mapper apply(state, event) — a missing row is a create, signalled by null.
  const persistedKeyArg = (f) => {
    if (f.identity) return 'evt.aggregateId()';
    // An unresolvable key has no event accessor to read — it goes through the
    // decider's DomainEvent overload (a throwing stub until hand-implemented).
    if (f.unmappableKey) return `decider.${f.name}(evt)`;
    // A derived field reads through the value-object field it was carved out
    // of — the event has no accessor of its own named after the derived path.
    return f.derivedFrom ? `evt.${f.derivedFrom.field}().${f.derivedFrom.attr}()` : `evt.${f.name}()`;
  };
  const projectCases = rm.subscribes
    .map((eid) => {
      const e = eventsById.get(eid);
      const keyExpr = compositeKey
        ? `new ${rm.idClassName}(${rm.keyFields.map(persistedKeyArg).join(', ')})`
        : 'evt.aggregateId()';
      return `            case ${e.className} evt -> {
                var state = repository.findById(${keyExpr})
                        .map(${rm.entityClassName}::toReadModel)
                        .orElse(null);
                apply(state, evt);
            }`;
    })
    .join('\n');

  // A "??" search-only criterion needs the decider too (for its matches<Field>
  // stub), even when no [bracketed] field ever delegated a projected VALUE to it.
  const searchOnlyFields = rm.searchOnlyFields || [];
  const collaborators = delegated || searchOnlyFields.length ? [repository, decider] : [repository];

  // Applied to the query result AFTER the repository call returns — never a DB
  // predicate. Each "??" field is checked only when present (and non-blank) in
  // the incoming search map; absent/blank means "don't filter on it".
  const searchOnlyFilters = searchOnlyFields
    .map(
      (f) =>
        `                .filter(r -> {
                    String v = search.get("${f.name}");
                    return v == null || v.isBlank() || decider.matches${naming.cap(f.name)}(v, r);
                })`,
    )
    .join('\n');

  // The query side is the ONLY thing ":Key" (single record) and ":RowKey"
  // (row list) change here: a single-record read model is looked up by its
  // aggregate id and answers with one row, a row-list one runs the search map
  // over the repository and answers with rows. The write side (apply/project,
  // one row advanced per event) is identical.
  const getter = rm.collection
    ? `    @GetMapping("${rm.getMapping}")
    public List<${rm.className}> ${rm.getterMethod}(@RequestParam Map<String, String> search) {
        return repository.findAllBySearch(search).stream()
                .map(${rm.entityClassName}::toReadModel)
${searchOnlyFilters ? searchOnlyFilters + '\n' : ''}                .toList();
    }`
    : `    @GetMapping("${rm.getMapping}")
    public ${rm.className} ${rm.getterMethod}(@PathVariable Long aggregateId) {
        return repository.findById(aggregateId)
                .map(${rm.entityClassName}::toReadModel)
                .orElse(null);
    }`;

  const imports = importBlock([
    ...(rm.collection ? ['java.util.List', 'java.util.Map'] : []),
    'lombok.RequiredArgsConstructor',
    'org.springframework.stereotype.Component',
    'org.springframework.web.bind.annotation.GetMapping',
    rm.collection
      ? 'org.springframework.web.bind.annotation.RequestParam'
      : 'org.springframework.web.bind.annotation.PathVariable',
    'org.springframework.web.bind.annotation.RestController',
    `${base}.eventstream.DomainEvent`,
    `${base}.eventstream.PersistingProjector`,
    ...collaboratorImports(collaborators),
    ...extraImports,
  ]);

  return {
    package: rm.package,
    className: rm.projectorClassName,
    overwrite: true,
    logic: true,
    collaborators,
    content: `package ${rm.package};

${imports}

@RestController
@Component
@RequiredArgsConstructor
public class ${rm.projectorClassName} implements PersistingProjector {

${fieldDeclarations(collaborators)}

${getter}

    @Override
    public void project(DomainEvent event) {
        switch (event) {
${projectCases}
            default -> {
            }
        }
    }

${applies.join('\n\n')}
}
`,
  };
}

export function persistingProjectorAbility(rm, ctx, collaborators) {
  const base = ctx.basePackage;
  // Mirror the projection's query shape: a row list is asserted over rows (and
  // its search map), a single record over the one row its aggregate id returns.
  const dsl = rm.collection
    ? `    default boolean ${rm.dslMethod}(Predicate<List<${rm.className}>> testCase) {
        return testCase.test(get${rm.projectorClassName}().${rm.getterMethod}(Map.of()));
    }

    default boolean ${rm.dslMethod}(Map<String, String> search, Predicate<List<${rm.className}>> testCase) {
        return testCase.test(get${rm.projectorClassName}().${rm.getterMethod}(search));
    }`
    : `    default boolean ${rm.dslMethod}(Long aggregateId, Predicate<${rm.className}> testCase) {
        return testCase.test(get${rm.projectorClassName}().${rm.getterMethod}(aggregateId));
    }`;
  return {
    test: true,
    package: rm.package,
    className: rm.abilityClassName,
    overwrite: true,
    content: `package ${rm.package};

${importBlock([
  ...(rm.collection ? ['java.util.List', 'java.util.Map'] : []),
  'java.util.function.Predicate',
  `${base}.eventstream.EventStreamAbility`,
])}

public interface ${rm.abilityClassName} extends EventStreamAbility {

    ${rm.inMemoryRepositoryClassName} ${rm.repositoryConstant} = new ${rm.inMemoryRepositoryClassName}();

    ${rm.projectorClassName} INSTANCE = EventStreamAbility.register(
            new ${rm.projectorClassName}(${constructorArgs(collaborators)}),
            ${rm.abilityClassName}.${rm.repositoryConstant}::deleteAll);

    default ${rm.projectorClassName} get${rm.projectorClassName}() {
        return ${rm.abilityClassName}.INSTANCE;
    }

${dsl}
}
`,
  };
}

// --- query read models (request/response, "---" divider) --------------------
// A query read model is a request -> runtime calculation -> response pattern:
// caller-provided request attributes in, computed response attributes out, no
// application state changed. Generated code is similar to a state projector's
// apply() seam but WITHOUT hydrate (no event-stream fold) and WITHOUT
// persisting (no repository, no entity, no PersistingProjector). The
// calculation lives in a projection decider whose stubs throw until a GWT
// scenario drives them out.

export function requestRecord(rm) {
  const imports = importBlock(rm.requestFields.flatMap((f) => f.imports));
  return {
    package: rm.package,
    className: rm.requestClassName,
    overwrite: true,
    content: `package ${rm.package};

${imports ? imports + '\n\n' : ''}public record ${rm.requestClassName}(${components(rm.requestFields)}) {
}
`,
  };
}

export function queryProjector(rm, ctx) {
  const base = ctx.basePackage;
  const extraImports = [];

  const decider = collaborator({
    fieldName: 'decider',
    className: rm.deciderClassName,
    testInstantiation: `new ${rm.deciderClassName}()`,
    scaffold: () => queryProjectionDecider(rm, base),
  });

  // Map each response field: name-match a request field -> request.field(),
  // [bracketed]/unmappable -> decider, anything else -> decider (no automatic
  // source without hydrate).
  let delegated = false;
  const args = rm.responseFields.map((f) => {
    const r = resolveArg(f, {
      sourceFields: rm.requestFields,
      sourceExpr: 'request',
      delegate: { ...decider, args: 'request' },
      fallback: (field) => `decider.${field.name}(request)`,
    });
    if (r.delegated) delegated = true;
    extraImports.push(...r.imports);
    return r.expr;
  });

  const collaborators = [decider];

  // REST endpoint: one @RequestParam per request field (none = no params).
  const requestParams = rm.requestFields
    .map((f) => `@RequestParam ${f.javaType} ${f.name}`)
    .join(', ');
  const requestArgs = rm.requestFields.map((f) => f.name).join(', ');
  const responseType = rm.collection ? `List<${rm.className}>` : rm.className;

  const imports = importBlock([
    ...(rm.collection ? ['java.util.List'] : []),
    'lombok.RequiredArgsConstructor',
    'org.springframework.stereotype.Component',
    'org.springframework.web.bind.annotation.GetMapping',
    'org.springframework.web.bind.annotation.RequestParam',
    'org.springframework.web.bind.annotation.RestController',
    ...collaboratorImports(collaborators),
    ...extraImports,
    ...rm.requestFields.flatMap((f) => f.imports),
    ...rm.responseFields.flatMap((f) => f.imports),
  ]);

  // Single-response: build the record from mapped fields. Collection: the
  // calculation may return any number of rows — generate a stub the developer
  // implements (same spirit as a [bracketed] decider stub).
  const applyBody = rm.collection
    ? `        throw new UnsupportedOperationException(
                "Query '${rm.id}' has no implementation yet");`
    : `        return new ${rm.className}(
${args.map((a) => `                ${a}`).join(',\n')});`;

  return {
    package: rm.package,
    className: rm.projectorClassName,
    overwrite: true,
    logic: true,
    collaborators,
    content: `package ${rm.package};

${imports}

@RestController
@Component
@RequiredArgsConstructor
public class ${rm.projectorClassName} {

${fieldDeclarations(collaborators)}

    @GetMapping("${rm.getMapping}")
    public ${responseType} ${rm.getterMethod}(${requestParams}) {
        return apply(new ${rm.requestClassName}(${requestArgs}));
    }

    public ${responseType} apply(${rm.requestClassName} request) {
${applyBody}
    }
}
`,
  };
}

// Decider stubs for a query read model. Stubs take (request) — there is no
// state or event to pass. Every response field that is not a request
// pass-through gets a stub: [bracketed] decisions, unmappable structured
// fields, and fields with no matching request field (no automatic source).
export function queryProjectionDecider(rm, base) {
  const methods = [];
  const imports = ['org.springframework.stereotype.Component'];
  const requestType = rm.requestClassName;
  const requestNames = new Set(rm.requestFields.map((f) => f.name));

  for (const f of rm.responseFields) {
    // A field that matches a request field is auto-mapped (request.field())
    // and needs no stub — unless it is [bracketed] or unmappable, which
    // override the name match and always delegate.
    const isPassThrough = requestNames.has(f.name) && !f.bracketed && !f.unmappable;
    if (isPassThrough) continue;
    if (f.convention) continue; // convention fields are auto-generated
    imports.push(...f.imports);
    const reason = f.bracketed
      ? `"[${f.label}]" on read model '${rm.id}' is a calculation decision with no GWT scenario yet`
      : f.unmappable
        ? `"Unsupported structured-field mapping: ${f.unmappable.reason}. Add a more detailed mapping prompt, then implement this method by hand."`
        : `"Response field '${f.label}' on read model '${rm.id}' has no matching request field — implement this calculation by hand."`;
    methods.push(`    public ${f.javaType} ${f.name}(${requestType} request) {
        throw new UnsupportedOperationException(
                ${reason});
    }`);
  }

  return {
    package: rm.package,
    className: rm.deciderClassName,
    once: true,
    version: SCAFFOLD_VERSION,
    content: `package ${rm.package};

${importBlock(imports)}

@Component
public class ${rm.deciderClassName} {

${methods.join('\n\n')}
}
`,
  };
}

export function queryProjectorAbility(rm, ctx, collaborators) {
  const responseType = rm.collection ? `List<${rm.className}>` : rm.className;
  const dsl = `    default boolean ${rm.dslMethod}(${rm.requestClassName} request, Predicate<${responseType}> testCase) {
        return testCase.test(get${rm.projectorClassName}().apply(request));
    }`;
  return {
    test: true,
    package: rm.package,
    className: rm.abilityClassName,
    overwrite: true,
    content: `package ${rm.package};

${importBlock([
  ...(rm.collection ? ['java.util.List'] : []),
  'java.util.function.Predicate',
])}

public interface ${rm.abilityClassName} {

    ${rm.projectorClassName} INSTANCE =
            new ${rm.projectorClassName}(${constructorArgs(collaborators)});

    default ${rm.projectorClassName} get${rm.projectorClassName}() {
        return ${rm.abilityClassName}.INSTANCE;
    }

${dsl}
}
`,
  };
}

