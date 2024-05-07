/**
 * 
 * @param {Element} element 
 * @returns {ChildNode[]}
 */
function getTextNodes(element){
    // return all immediate child text nodes
    const TEXT_NODE_TYPE=3
    return Array.from(element.childNodes).filter((node)=>node.nodeType==TEXT_NODE_TYPE)
}
/**
 * get a list of template replacements in a string
 * 
 * @example
 * getReplacements("{{a}} and {{b}}") // returns ["a","b"]
 * 
 * @example
 * let somestr="{{a}} and {{b}}"
 * let a=2
 * let b=3
 * for(let replacement of getReplacements(somestr)){
 *    somestr=somestr.replace("{{"+replacement+"}}",eval(replacement))
 * }
 * console.log(somestr) // prints "2 and 3"
 * 
 * @param {string} text 
 * @returns {string[]}
 */
function getReplacements(text){
    let replacements=[]
    let match
    // match all {{...}} patterns
    let re=/{{(.*?)}}/g
    while(match=re.exec(text)){
        replacements.push(match[1])
    }
    return replacements
}

class Binding{
    /**
     * @param {string} name
     * @param {any} value
     */
    constructor(name,value){
        this.name=name
        this.value=value
    }
}
class Bindings{
    /**
     * create new bindings set
     * @param {Map<string,Binding>|Binding[]|Binding} init_bindings 
     */
    constructor(init_bindings=[]){
        /** @type {Map<string,Binding>} */
        this.bindings=new Map()
        /** @type {Bindings[]} */
        this.inherited_bindings=[]
        /** @type {Map<number,Binding>} */
        this.value_map=new Map()
        this._new_value_index=0

        this.add(init_bindings)
    }
    /**
     * used internally to add exactly one binding to the set
     * @param {Binding} binding 
     * @returns 
     */
    _addBinding(binding){
        if(this.bindings.has(binding.name)){
            console.error("binding name already exists",binding)
            return
        }
        this.bindings.set(binding.name,binding)
    }
    /**
     * add bindings directly to this set
     * @param {Binding|Map<string,Binding>|Binding[]} binding
     */
    add(binding){
        if(binding instanceof Array){
            for(let b of binding){
                this._addBinding(b)
            }
        }else if(binding instanceof Map){
            for(let [name,b] of binding){
                this._addBinding(b)
            }
        }else{
            this.bindings.set(binding.name,binding)
        }
    }
    /**
     * creates reference to binding set (reference, NOT a copy!)
     * 
     * allows referencing bindings from e.g. parent elements by a child without duplicating the bindings
     * 
     * @param {Bindings} bindings 
     */
    inherit(bindings){
        if(bindings===this){console.error("attempted to inherit itself");return}
        
        this.inherited_bindings.push(bindings)

        // check that there are no duplicate bindings
        try{
            this._getBindingMap()
        }catch(e){
            console.error("error in inherited bindings",e)
            console.error("self",this,"attempted to inherit from",bindings)
        }
    }
    /**
     * used internally to store binding values in a map
     * @param {Binding} binding 
     * @return {number} the index of the value in the value map to be used in eval'able code via _getBindingValue
     */
    _createBindingIndex(binding){
        let binding_map_index=this._new_value_index
        this.value_map.set(binding_map_index,binding)
        this._new_value_index+=1
        return binding_map_index
    }
    /**
     * used internally to retrieve binding values through eval'able code (which itself a string, this method circumvents data serialization)
     * 
     * binding_index argument is created by _createBindingIndex
     * 
     * @param {number} binding_index 
     * @returns {Binding}
     */
    _getBindingValue(binding_index){
        let ret=this.value_map.get(binding_index)
        // check inherited bindings
        for(let inheritedBindingList of this.inherited_bindings){
            if(ret)
                break

            try{
                ret=inheritedBindingList._getBindingValue(binding_index)
            }catch(e){}
        }

        if(!ret)
            throw new Error("binding index not found"+binding_index)

        return ret
    }
    /**
     * return eval'able string to make a binding usable in code
     * @param {Binding} binding 
     * @param {string} binding_varname
     * @returns {string}
     */
    _expandBinding(binding,binding_varname){
        return "let "+binding.name+"="+binding_varname+"._getBindingValue("+this._createBindingIndex(binding)+").value ; "
    }

    /**
     * return map of all bindings, including inherited bindings
     * 
     * prints error on duplicate bindings (i.e. binding with same name but non-identical values. identical name+value are allowed)
     * 
     * @returns {Map<string,Binding>}
     */
    _getBindingMap(){
        let ret=new Map()
        for(let [name,binding] of this.bindings){
            if(ret.has(name) && binding.value!==ret.get(name).value){console.error("duplicate binding",binding,"conflicts with",ret.get(name))}
            ret.set(name,binding)
        }
        for(let inheritedBindingList of this.inherited_bindings){
            let inheritedBindings=inheritedBindingList._getBindingMap()
            for(let [name,binding] of inheritedBindings){
                if(ret.has(name) && binding.value!==ret.get(name).value){console.error("duplicate binding",binding,"conflicts with",ret.get(name));continue}
                ret.set(name,binding)
            }
        }
        return ret
    }

    /**
     * combines bindings into an eval-able string
     * 
     * uses let bindings, so scope of the bindings is limited to the eval statement itself!
     * e.g. returns "let mybind=<some expression evaluating to the binding value> ; let mybind2=<...> ; "
     * 
     * handles duplicate bindings, either via inheritance or in the same bindings list (binding the same value to the same name is allowed, but not binding different values to the same name)
     * throws on error (i.e. on duplicate binding names with different values)
     * 
     * @param {string} bindings_varname 
     * @param {Map<string,Binding>} existing_bindings
     * @returns {string}
     */
    expand(bindings_varname,existing_bindings=new Map()){
        // this returns a map of all bindings, including inherited bindings
        // it also throws on duplicate binding names, if the bindings dont point to the same value
        if(existing_bindings.size==0)
            this._getBindingMap()

        let ret=""
        for(let inheritedBindingList of this.inherited_bindings){
            ret+=inheritedBindingList.expand(bindings_varname,existing_bindings)

            for(let [name,binding] of inheritedBindingList._getBindingMap()){
                if(existing_bindings.has(name)){continue}
                existing_bindings.set(name,binding)
            }
        }
        for(let [name,binding] of this.bindings){
            if(existing_bindings.has(name)){continue}
            ret+=this._expandBinding(binding,bindings_varname)
        }
        return ret
    }

    /**
     * used internally to store bindings for each element in the dom
     * 
     * (does NOT auto-remove elements that are removed from the dom)
     * 
     * @type {Map<Element,Bindings>}
     * */
    static _elementBindings=new Map()

    /**
     * retrieve bindings set for an element
     * 
     * if a set does not already exist, one is created
     * 
     * @param {Element} element 
     * @returns {Bindings}
     */
    static getForElement(element){
        if(!Bindings._elementBindings.has(element)){
            Bindings._elementBindings.set(element,new Bindings())
        }
        let ret=Bindings._elementBindings.get(element)
        if(!ret){throw new Error("unreachable")}
        return ret
    }
}


/**
 * return the content of a template element, or null if the element is not a template
 * @param {Element} element
 * @returns {DocumentFragment|null}
 */
function templateElementContent(element){
    if(element.tagName=="TEMPLATE" && "content" in element && element.content!=null && element.content instanceof DocumentFragment){
        return element.content
    }
    return null
}

class EvalStack{
    /** @type {any[]} */
    static stack=[]
    static done=true

    static begin(){
        EvalStack.done=false
        EvalStack.stack=[]
    }
    /**
     * 
     * @returns {any[]}
     */
    static end(){
        EvalStack.done=true
        let ret=EvalStack.stack
        EvalStack.stack=[]
        return ret
    }
}

class Manager{
    constructor(){
        document.addEventListener("DOMContentLoaded",()=>{
            let target_elements=document.querySelectorAll(".data")
            /// @ts-ignore
            this.init(target_elements)
        })
        this.managedValues=new Map()
        this.managedProxies=new Map()
        this.objCallbacks=new Map()
        /** @type {Map<Element,{node:ChildNode,templateText:string}[]>} */
        this.objTextNodes=new Map()
        this.namedObjCallbacks=new Map()
        /** @type {Set<HTMLElement>} */
        this.initializedElements=new Set()
    }
    /**
     * 
     * @param {Element} element 
     * @returns {(()=>void)[]} - returns a function that can be called to remove the generated callbacks 
     */
    replaceMatches(element){
        let me=this
        let bindings_=Bindings.getForElement(element)
        let bindings_str=bindings_.expand("bindings_")

        if(!this.objTextNodes.has(element)){
            let textNodes=getTextNodes(element).map((node)=>{return {"node":node,"templateText":node.nodeValue}})
            textNodes=textNodes.filter((entry)=>{return entry.templateText!=null})
            /// @ts-ignore
            this.objTextNodes.set(element,textNodes)
        }
        let textNodes=this.objTextNodes.get(element)
        let remove_callbacks_from_textnodes=[]
        if(textNodes!=null && textNodes.length>0){
            for(let textNode of textNodes){
                function replace(registerFromStack=false){
                    let template=textNode.templateText

                    let remove_callbacks=[]
                    for(let entry of getReplacements(template)){
                        if(registerFromStack)
                            EvalStack.begin()

                        const newValue=eval(bindings_str+entry)
                        template=template.replace("{{"+entry+"}}",newValue)

                        if(registerFromStack){
                            let stack=EvalStack.end()
                            let lastInStack=stack[stack.length-1]
                            if(stack.length===0){
                                console.error("stack is empty. maybe object is not managed?",entry,"=",newValue)
                            }

                            remove_callbacks.push(me.registerCallback(lastInStack[0],(o,p,n)=>{
                                replace(false)
                            },lastInStack[1]))
                        }
                    }
                    textNode.node.nodeValue=template

                    return remove_callbacks
                }
                remove_callbacks_from_textnodes.push(replace(true).flat(100))
            }
        }

        // iterate over all attributes and replace matches in their values
        for(let attributeIndex=0;attributeIndex<element.attributes.length;attributeIndex++){
            let attribute=element.attributes.item(attributeIndex)
            if(!attribute)continue;

            let remove_callbacks=[]
            let raw_value=attribute.value
            for(let entry of getReplacements(raw_value)){
                let replaced_value=eval(bindings_str+entry)
                attribute.value=raw_value.replace("{{"+entry+"}}",replaced_value)

                remove_callbacks.push(this.registerCallback(replaced_value,(o,p,n)=>{
                    attribute.value=raw_value.replace("{{"+entry+"}}",eval(bindings_str+entry))
                }))
            }
            remove_callbacks_from_textnodes.push(remove_callbacks)
        }

        for(let child of element.children){
            Bindings.getForElement(child).inherit(bindings_)
            remove_callbacks_from_textnodes.push(this.replaceMatches(child).flat(100))
        }

        return remove_callbacks_from_textnodes.flat(100)
    }
    /**
     * @brief register an object for managing, returns the wrapper (proxy) object
     * @template {object} T
     * @param {T|Proxy<T>} obj 
     * @param {((o:object,property:string|symbol,new_value:any)=>void)[]} inheritedCallbacks
     * @returns {Proxy<T>}
     */
    ensureManagedObject(obj,inheritedCallbacks=[]){
        // if object argument is proxy, return
        if(this.managedProxies.has(obj)){
            /// @ts-ignore
            return obj
        }

        if(!this.managedValues.has(obj)){
            let me=this

            if(inheritedCallbacks.length>0){
                me.objCallbacks.set(obj,[inheritedCallbacks])
            }
            let new_proxy=new Proxy(obj,{
                get:(target,prop)=>{
                    if(!EvalStack.done){
                        /// @ts-ignore
                        EvalStack.stack.push([target,prop])
                    }
                    let ret=Reflect.get(target,prop)

                    // if prop is in this list of properties, return the value of the property immediately
                    if(typeof prop == "symbol" || typeof ret == "function" || ["valueOf","toString","length"].includes(prop)){
                        return ret
                    }

                    if(typeof ret=="object"){
                        /// @ts-ignore
                        return me.ensureManagedObject(ret,me.objCallbacks.get(obj))
                    }
                    EvalStack.done=true
                    return ret
                },
                set:(target,prop,value)=>{
                    Reflect.set(target,prop,value)
                    let namedObjectCallbacksForObj=me.namedObjCallbacks.get(obj)
                    if(namedObjectCallbacksForObj){
                        let callbacks=namedObjectCallbacksForObj.get(prop)
                        if(callbacks){
                            for(let callback of callbacks){
                                callback(target,prop,value)
                            }
                        }
                    }
                    me.triggerChange(target,prop,value)
                    return true
                }
            })
            this.managedValues.set(obj,new_proxy)
            this.managedProxies.set(new_proxy,obj)
        }
        return this.managedValues.get(obj)
    }
    /**
     * @brief manage an object, wrapper for a more complex (internal) function
     * @template T
     * @param {T&object} obj 
     * @returns {Proxy<T>}
     */
    manage(obj){
        return this.ensureManagedObject(obj)
    }
    /**
     * obj should be the regular (non-proxy) object
     * @param {object} obj 
     * @param {(o:object,property:string|symbol,new_value:any)=>void} callback 
     * @return {(()=>void)[]} - returns a function that can be called to remove the callback
     */
    registerCallback(obj,callback,key=null){
        let me=this
        if(key!=null){
            if(!this.namedObjCallbacks.has(obj)){
                this.namedObjCallbacks.set(obj,new Map())
            }
            if(!this.namedObjCallbacks.get(obj).has(key)){
                this.namedObjCallbacks.get(obj).set(key,[])
            }
            let i=this.namedObjCallbacks.get(obj).get(key).push(callback)

            return [function(){
                let callbacks=me.namedObjCallbacks.get(obj).get(key)
                let i=0
                for(let f of callbacks){
                    if(f==callback){
                        callbacks.splice(i,1)
                    }
                    i+=1
                }
            }]
        }else{
            if(!this.objCallbacks.has(obj)){
                this.objCallbacks.set(obj,[])
            }
            this.objCallbacks.get(obj).push(callback)

            return [function(){
                let callbacks=me.objCallbacks.get(obj)
                let i=0
                for(let f of callbacks){
                    if(f==callback){
                        callbacks.splice(i,1)
                    }
                    i+=1
                }
            }]
        }
    }
    /**
     * 
     * @param {object} obj 
     * @param {string|symbol} property 
     * @param {any} new_value 
     */
    triggerChange(obj,property,new_value){
        let callbacks=this.objCallbacks.get(obj)
        if(!callbacks){return;}

        // flatten to handle inherited callbacks
        for(let callback of callbacks.flat(100)){
            if(!(callback instanceof Function)){console.error(callback,"not instanceof Function");continue;}
            callback(property,new_value)
        }
    }
    /**
     * 
     * @param {Element[]|HTMLCollection} target_elements
     * @returns {{remove:(()=>void)[]}}
     */
    init(target_elements){
        let ret={remove:[]}

        for(let element of target_elements){
            if(!(element instanceof HTMLElement)){console.error(element,"not instanceof HTMLElement");continue;}
            let bindings_in=Bindings.getForElement(element)

            // keep track of initialized elements to avoid double initialization
            if(this.initializedElements.has(element)){
                continue;
            }
            this.initializedElements.add(element)
            
            let child_elements=Array.from(element.children)
            for(let child of child_elements){
                if(!(child instanceof HTMLElement)){console.error(child,"not instanceof HTMLElement");continue;}
                let bindings=Bindings.getForElement(child)
                bindings.inherit(bindings_in)
            }

            /** @type{Element[]} */
            let copiedElements=[]
            /** @type{(()=>void)[]} */
            let remove_callbacks=[]

            const p_for_attribute=element.getAttribute("p:for")
            if(p_for_attribute){
                let [item_name,container_name]=p_for_attribute.split(" of ")

                let container=this.ensureManagedObject(eval(bindings_in.expand("bindings_in")+container_name))
                
                const applyPFor=(()=>{
                    for(let cb of remove_callbacks){
                        cb()
                    }

                    if(!element.parentElement){console.error(element,"has no parent");return;}

                    copiedElements=[]
                    remove_callbacks=[]
                    
                    /** @ts-ignore - container is iterable */
                    for(let item of container){
                        let element_templates
                        // if element is a template
                        let elementTemplateDocumentFragment=templateElementContent(element)
                        if(elementTemplateDocumentFragment){
                            element_templates=elementTemplateDocumentFragment.children
                        }else{
                            element_templates=element.children
                        }

                        for(let element_template of element_templates){
                            let clone=element_template.cloneNode(true)
                            if(!(clone instanceof Element)){console.error(clone,"not instanceof Element");return;}

                            // make clone visible as such in DOM
                            clone.setAttribute("_pClonedFromTemplate","true")

                            copiedElements.push(clone)
                            element.parentElement.insertBefore(clone,element)
                            remove_callbacks.push(function(){clone.parentElement?.removeChild(clone)})

                            let inheritedBindings=Bindings.getForElement(clone)
                            inheritedBindings.inherit(bindings_in)
                            inheritedBindings.add(new Binding(item_name,item))
                            
                            // check if container is free-standing expression, e.g. "items", not a compound like "data.items" or "data(mydata).values[3]"
                            // check by assigning a value to the container expression
                            try{
                                eval("let "+container_name+"=2")
                                inheritedBindings.add(new Binding(container_name,container))
                            }catch(e){}

                            remove_callbacks=remove_callbacks.concat(this.replaceMatches(clone))
                        }
                    }
                    remove_callbacks=remove_callbacks.concat(this.init(copiedElements).remove)
                }).bind(this)

                this.registerCallback(this.managedProxies.get(container),(obj,property,newval)=>{
                    applyPFor()
                })

                applyPFor()
            }

            // initialize all child elements
            remove_callbacks=remove_callbacks.concat(this.init(child_elements).remove)

            const p_init_attribute=element.getAttribute("p:init")
            if(p_init_attribute){
                let bindings=new Bindings()
                bindings.inherit(bindings_in)
                // add local variable "element"
                bindings.add(new Binding("element",element))
                eval(bindings.expand("bindings")+p_init_attribute)
            }

            // handle p:bind attributes
            const p_bind_attribute=element.getAttribute("p:bind")
            while(p_bind_attribute){
                const elementIsInput=element instanceof HTMLInputElement
                const elementIsSelect=element instanceof HTMLSelectElement
                if(!(elementIsInput || elementIsSelect)){console.error("element not instanceof HTMLInputElement, instead is ",element);break;}
                const elementIsCheckbox=elementIsInput && element.getAttribute("type")==="checkbox"

                EvalStack.begin()
                const initial_value=eval(bindings_in.expand("bindings_in")+p_bind_attribute)
                const eval_stack=EvalStack.end()
                if(eval_stack.length==0 || eval_stack[0].length==0){
                    console.error("no eval stack. maybe object is not managed?",element,p_bind_attribute)
                    break
                }

                let elementValuePropertyName
                if(elementIsCheckbox){
                    element.checked=initial_value
                    elementValuePropertyName="checked"
                }else{
                    element.value=initial_value
                    elementValuePropertyName="value"
                }

                /**
                 * block recursion, e.g.:
                 * 
                 * ... -> element value change -> js value changes -> element value changes -> ...
                 * */
                let writeInputValueBack=false

                // register callback to reflect js value changes in DOM
                this.registerCallback(eval_stack[0][0],(o,p,n)=>{
                    if(writeInputValueBack){return;}

                    const bindings=Bindings.getForElement(element)
                    const bindings_str=bindings.expand("bindings")

                    // set new value on input element
                    eval(bindings_str+"element."+elementValuePropertyName+"="+p_bind_attribute)
                },eval_stack[0][1])

                // register callback to reflect DOM value changes in js
                element.addEventListener("input",(event)=>{
                    writeInputValueBack=true

                    const bindings=Bindings.getForElement(element)
                    const bindings_str=bindings.expand("bindings")

                    eval(bindings_str+p_bind_attribute+"=element."+elementValuePropertyName)

                    writeInputValueBack=false
                })

                break
            }

            // handle p:on-* attributes, e.g. p:on-click="..."
            for(let attributeIndex=0;attributeIndex<element.attributes.length;attributeIndex++){
                let attribute=element.attributes.item(attributeIndex)
                if(!attribute)continue;

                if(attribute.name.startsWith("p:on-")){
                    let eventnames=attribute.name.slice("p:on-".length)
                    let code=attribute.value
                    if(code){
                        for(let event_name of eventnames.split(",")){
                            event_name=event_name.trim()
                            if(event_name.length==0)continue;

                            let element_bindings=Bindings.getForElement(element)
                            element.addEventListener(event_name,(e)=>{
                                /** provide local variable 'event' for use in the eval statement */
                                let event=e
                                eval(element_bindings.expand("element_bindings")+code)
                            })
                        }
                    }
                }
            }

            for(let cb of this.replaceMatches(element).concat(remove_callbacks).flat(100)){
                /// @ts-ignore
                ret.remove.push(cb)
            }
        }
        return ret
    }
}
