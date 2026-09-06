// Core type definitions — pure JSDoc (no TypeScript)
// These are the stable contracts that plugins implement

/**
 * @typedef {Object} Model
 * @property {{basePackage: string}} meta
 * @property {ValueObject[]} valueObjects
 * @property {Event[]} events
 * @property {Command[]} commands
 * @property {ReadModel[]} readModels
 */

/**
 * @typedef {Object} ValueObject
 * @property {'value-object'} kind
 * @property {string} className
 * @property {string} package
 * @property {Field[]} fields
 * @property {Attr[]} attrs
 * @property {boolean} embeds
 */

/**
 * @typedef {Object} Field
 * @property {string} label
 * @property {string} name
 * @property {string} javaType
 * @property {string[]} imports
 * @property {boolean} bracketed
 * @property {string|null} convention
 * @property {string|null} conventionExpr
 * @property {boolean} [key]
 * @property {ValueObjectRef} [valueObject]
 * @property {boolean} [embeds]
 * @property {Attr[]} [attrs]
 */

/**
 * @typedef {Object} ValueObjectRef
 * @property {string} className
 * @property {string} package
 */

/**
 * @typedef {Object} Attr
 * @property {string} name
 * @property {string} javaType
 */

/**
 * @typedef {Object} Event
 * @property {string} id
 * @property {string} name
 * @property {string} aggregate
 * @property {Field[]} fields
 * @property {string} className
 * @property {string} package
 * @property {string} typeEnum
 * @property {string} serdeClassName
 * @property {string} serdePackage
 */

/**
 * @typedef {Object} Command
 * @property {string} id
 * @property {string} name
 * @property {string} producesId
 * @property {Field[]} fields
 * @property {string} className
 * @property {string} package
 * @property {string} handlerClassName
 * @property {string} deciderClassName
 * @property {string} abilityClassName
 * @property {string} postMapping
 * @property {string} dslMethod
 */

/**
 * @typedef {Object} ReadModel
 * @property {string} id
 * @property {string} name
 * @property {string} aggregate
 * @property {boolean} onDemand
 * @property {boolean} keyed
 * @property {string[]} subscribes
 * @property {Field[]} fields
 * @property {Field[]} keyFields
 * @property {string} className
 * @property {string} package
 * @property {string} projectorClassName
 * @property {string} deciderClassName
 * @property {string} abilityClassName
 * @property {string} getterMethod
 * @property {string} getMapping
 * @property {string} dslMethod
 * @property {string} [entityClassName]
 * @property {string} [idClassName]
 * @property {string} [repositoryClassName]
 * @property {string} [jpaRepositoryClassName]
 * @property {string} [inMemoryRepositoryClassName]
 * @property {string} [tableName]
 * @property {string} [repositoryConstant]
 */

/**
 * @typedef {Object} File
 * @property {string} category
 * @property {string} package
 * @property {string} className
 * @property {string} content
 * @property {boolean} overwrite
 * @property {boolean} [logic]
 * @property {boolean} [once]
 * @property {number} [version]
 * @property {boolean} [test]
 * @property {Collaborator[]} [collaborators]
 */

/**
 * @typedef {Object} Collaborator
 * @property {string} fieldName
 * @property {string} className
 * @property {string} testInstantiation
 * @property {string[]} imports
 * @property {() => File} [scaffold]
 */

/**
 * @typedef {Object} ParsedSection
 * @property {string} id
 * @property {Record<string, string>} props
 * @property {ParsedField[]} fields
 * @property {string|null} aggregate
 * @property {boolean} keyed
 */

/**
 * @typedef {Object} ParsedField
 * @property {string} label
 * @property {string} name
 * @property {boolean} bracketed
 * @property {string|null} convention
 * @property {boolean} [key]
 */

/**
 * @typedef {Object} Definition
 * @property {string} name
 * @property {string[]} attributes
 */

/**
 * @typedef {Object} NamingConventions
 * @property {(s: string) => string[]} words
 * @property {(s: string) => string} pascal
 * @property {(s: string) => string} cap
 * @property {(s: string) => string} camel
 * @property {(s: string) => string} screamingSnake
 * @property {(s: string) => string} snake
 * @property {(s: string) => string} slicePackage
 * @property {(base: string, id: string) => CommandNaming} command
 * @property {(base: string, id: string) => EventNaming} event
 * @property {(base: string, id: string, opts: {keyed?: boolean}) => ReadModelNaming} readModel
 * @property {(base: string, name: string) => {className: string, package: string}} valueObject
 * @property {(name: string) => string} field
 * @property {(root: string, pkg: string, className: string, ext?: string) => string} path
 */

/**
 * @typedef {Object} CommandNaming
 * @property {string} className
 * @property {string} package
 * @property {string} handlerClassName
 * @property {string} deciderClassName
 * @property {string} abilityClassName
 * @property {string} postMapping
 * @property {string} dslMethod
 */

/**
 * @typedef {Object} EventNaming
 * @property {string} className
 * @property {string} package
 * @property {string} typeEnum
 * @property {string} serdeClassName
 * @property {string} serdePackage
 */

/**
 * @typedef {Object} ReadModelNaming
 * @property {string} className
 * @property {string} package
 * @property {string} projectorClassName
 * @property {string} deciderClassName
 * @property {string} abilityClassName
 * @property {string} getterMethod
 * @property {string} getMapping
 * @property {string} dslMethod
 * @property {string} entityClassName
 * @property {string} idClassName
 * @property {string} repositoryClassName
 * @property {string} jpaRepositoryClassName
 * @property {string} inMemoryRepositoryClassName
 * @property {string} tableName
 * @property {string} repositoryConstant
 */