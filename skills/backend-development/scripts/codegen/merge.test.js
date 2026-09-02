// Unit tests for add-only reconciliation of GENERATED files.
//
// merge.js is the only module that REWRITES a file that already exists, so it is
// the only one that can silently destroy or corrupt work. It shipped untested,
// and did exactly that (see "the historical corruption" below). Every case here
// is either a real bug that occurred or an invariant that keeps it from
// happening again.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeGenerated } from './merge.js';

const typeCount = (src, decl) => (src.match(new RegExp(decl, 'g')) || []).length;

// --- the historical corruption ----------------------------------------------
// The skeleton commit carried this placeholder. Its first `{` is inside the
// JAVADOC (`* @JsonSubTypes({`), and the generator's own output opens with an
// annotation brace too (`@JsonSubTypes({`). splitFile took "first `{` in the
// file", so both were split mid-comment/annotation: the annotation tail plus the
// type declaration looked like a class MEMBER, was found "missing", and got
// appended — producing a file with TWO top-level interfaces, written silently,
// after which --check reported "up to date" forever.

const PLACEHOLDER = `package p.infrastructure;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonSubTypes;
import com.fasterxml.jackson.annotation.JsonTypeInfo;
import p.domain.events.DomainEventType;
import p.eventstream.DomainEvent;

/**
 * @JsonSubTypes({
 *         @JsonSubTypes.Type(value = FooEventSerdeWrapper.class, name = "FOO"),
 *         @JsonSubTypes.Type(value = BarEventSerdeWrapper.class, name = "BAR"),
 * })
 */
@JsonTypeInfo(
        use = JsonTypeInfo.Id.NAME,
        include = JsonTypeInfo.As.EXISTING_PROPERTY,
        property = "eventType")
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonInclude(JsonInclude.Include.NON_NULL)
public interface DomainEventSerdeWrapper {
    DomainEventType getEventType();
    DomainEvent event();
}
`;

const GENERATED_WRAPPER = `package p.infrastructure;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonSubTypes;
import com.fasterxml.jackson.annotation.JsonTypeInfo;
import p.domain.events.DomainEventType;
import p.eventstream.DomainEvent;

@JsonTypeInfo(
        use = JsonTypeInfo.Id.NAME,
        include = JsonTypeInfo.As.EXISTING_PROPERTY,
        property = "eventType")
@JsonSubTypes({
        @JsonSubTypes.Type(value = PolicyIssuedEventSerdeWrapper.class, name = "POLICY_ISSUED"),
})
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonInclude(JsonInclude.Include.NON_NULL)
public interface DomainEventSerdeWrapper {
    DomainEventType getEventType();
    DomainEvent event();
}
`;

test('a brace inside a javadoc/annotation never splits the file (the historical corruption)', () => {
  const r = mergeGenerated(PLACEHOLDER, GENERATED_WRAPPER);
  assert.notEqual(r, null);
  // Both members already exist — nothing is "missing", so nothing is added.
  assert.deepEqual(r.added, []);
  assert.equal(typeCount(r.content, 'public interface'), 1);
  assert.doesNotMatch(r.added.join(' '), /field DomainEventSerdeWrapper/);
});

test('an annotation argument brace is not mistaken for the type body', () => {
  const generatedPlusMember = GENERATED_WRAPPER.replace(
    '    DomainEvent event();\n',
    '    DomainEvent event();\n\n    String describe();\n',
  );
  const r = mergeGenerated(GENERATED_WRAPPER, generatedPlusMember);
  assert.deepEqual(r.added, ['String describe()']);
  assert.equal(typeCount(r.content, 'public interface'), 1);
  assert.match(r.content, /@JsonSubTypes\(\{/); // annotation survived intact
});

// --- comments are prose, not structure ---------------------------------------

test('a javadoc {@code X} brace does not chop a member in half', () => {
  const existing = `package p;
public class A {

    /** Doc with {@code X} and a ; inside. */
    public void foo() {
    }
}
`;
  const generated = `package p;
public class A {

    /** Doc with {@code X} and a ; inside. */
    public void foo() {
    }

    public void bar() {
    }
}
`;
  const r = mergeGenerated(existing, generated);
  assert.deepEqual(r.added, ['public void bar()']);
  assert.equal(typeCount(r.content, 'public void foo'), 1);
  assert.equal(typeCount(r.content, 'public void bar'), 1);
});

test('rewording a javadoc does not make a member look new', () => {
  const existing = `package p;
public class A {

    /** Old wording. */
    public void foo() {
    }
}
`;
  const generated = existing.replace('Old wording', 'Completely different wording');
  const r = mergeGenerated(existing, generated);
  assert.deepEqual(r.added, []);
  assert.equal(typeCount(r.content, 'public void foo'), 1);
});

test('a brace inside a string literal is not structure', () => {
  const existing = `package p;
public class A {

    public String tpl() {
        return "a } brace { in a string";
    }
}
`;
  const generated = existing.replace(
    '    }\n}\n',
    '    }\n\n    public String other() {\n        return "x";\n    }\n}\n',
  );
  const r = mergeGenerated(existing, generated);
  assert.deepEqual(r.added, ['public String other()']);
  assert.equal(typeCount(r.content, 'public String tpl'), 1);
});

// --- add-only semantics still hold -------------------------------------------

test('a hand-added member survives while a new generated member is inserted', () => {
  const existing = `package p;
public class A {

    public void generated() {
    }

    public List<X> searchByHolder(String holder) {
        return repository.search(holder);
    }
}
`;
  const generated = `package p;
public class A {

    public void generated() {
    }

    public void freshFromModel() {
    }
}
`;
  const r = mergeGenerated(existing, generated);
  assert.deepEqual(r.added, ['public void freshFromModel()']);
  assert.match(r.content, /searchByHolder/);
});

test('an ad-hoc @RequestParam on the same route is the same slot, not a new overload', () => {
  const handExtended = `package p;
public class PolicyListProjector {

    @GetMapping("policy-list")
    public List<PolicyList> getPolicyList(@RequestParam(required = false) String policyHolder) {
        return repository.search(policyHolder);
    }
}
`;
  const generated = `package p;
public class PolicyListProjector {

    @GetMapping("policy-list")
    public List<PolicyList> getPolicyList() {
        return repository.findAll();
    }
}
`;
  const r = mergeGenerated(handExtended, generated);
  assert.deepEqual(r.added, []);
  assert.equal(typeCount(r.content, 'getPolicyList'), 1);
  assert.match(r.content, /@RequestParam/);
});

test('record components and enum constants are added, not duplicated', () => {
  const rec = mergeGenerated(
    'package p;\npublic record R(String a) {\n}\n',
    'package p;\npublic record R(String a, int b) {\n}\n',
  );
  assert.deepEqual(rec.added, ['b']);
  assert.match(rec.content, /record R\(String a, int b\)/);

  const en = mergeGenerated(
    'package p;\npublic enum E {\n    FIRST,\n}\n',
    'package p;\npublic enum E {\n    FIRST,\n    SECOND,\n}\n',
  );
  assert.deepEqual(en.added, ['SECOND']);
  assert.equal(typeCount(en.content, 'FIRST'), 1);
});

// --- refuses to write what it cannot re-parse --------------------------------

test('a file with no top-level type is not merged', () => {
  const r = mergeGenerated('package p;\n// just a comment\n', 'package p;\npublic class A {\n}\n');
  assert.equal(r, null);
});

test('a result that would not be a single balanced type is refused', () => {
  const twoTypes = `package p;
public class A {
    public void foo() {
    }
}

class Sneaky {
}
`;
  const generated = `package p;
public class A {
    public void foo() {
    }

    public void bar() {
    }
}
`;
  assert.equal(mergeGenerated(twoTypes, generated), null);
});
