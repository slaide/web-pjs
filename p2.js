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
     * used internally to retrieve binding values through eval'able code (which itself a string, this method circumvents data serialization)
     * 
     * binding_name argument is the name of an existing binding
     * 
     * @param {string} binding_name
     * @returns {Binding}
     */
    _getBindingValue(binding_name){
        let ret=this.bindings.get(binding_name)
        if(ret)
            return ret

        // check inherited bindings
        for(let inheritedBindingList of this.inherited_bindings){
            try{
                ret=inheritedBindingList._getBindingValue(binding_name)
            }catch(e){}
        }

        if(!ret)
            throw new Error("binding not found"+binding_name)

        return ret
    }
    /**
     * return eval'able string to make a binding usable in code
     * @param {Binding} binding 
     * @param {string} binding_varname
     * @returns {string}
     */
    _expandBinding(binding,binding_varname){
        return "let "+binding.name+"="+binding_varname+"._getBindingValue(`"+binding.name+"`).value ; "
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
        /** @param {Map<string,Binding>} bindings */
        function iterAndSetBindings(bindings){
            for(let [name,binding] of bindings){
                if(ret.has(name) && binding.value!==ret.get(name).value){
                    console.warn("duplicate binding",binding,"conflicts with",ret.get(name))
                    continue
                }
                ret.set(name,binding)
            }
        }
        // iter over own bindings
        iterAndSetBindings(this.bindings)
        // then descend into inherited bindings
        this.inherited_bindings.forEach(b=>iterAndSetBindings(b._getBindingMap()))
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
     * @param {Map<string,Binding>?} existing_bindings
     * @returns {string}
     */
    expand(bindings_varname,existing_bindings=null){
        // this returns a map of all bindings, including inherited bindings
        // it also throws on duplicate binding names, if the bindings dont point to the same value
        if(!existing_bindings)
            existing_bindings=new Map()

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

/**
 * @typedef {(obj:object,property:PropertyKey,value:any)=>void} ProxySetterInterceptCallback
 */

class Manager{
    /**
     * 
     * @param {{intervalFPS:number}?} options 
     */
    constructor(options=null){
        document.addEventListener("DOMContentLoaded",()=>{
            let target_elements=document.querySelectorAll(".data")
            /// @ts-ignore
            this.init(target_elements)
        })
        this.managedValues=new Map()
        this.managedProxies=new Map()
        /** @type {Map<object,ProxySetterInterceptCallback[]>} */
        this.objCallbacks=new Map()
        /** @type {Map<Element,{node:ChildNode,templateText:string}[]>} */
        this.objTextNodes=new Map()
        /** @type {Map<object,Map<PropertyKey,ProxySetterInterceptCallback[]>>} */
        this.namedObjCallbacks=new Map()
        /** @type {Set<HTMLElement>} */
        this.initializedElements=new Set()

        /** @type {Map<HTMLElement,(()=>void)[]>} */
        this._firstDrawCallbacks=new Map()
        /** @type {Set<HTMLElement>} */
        this._firstDrawCompleted=new Set()

        this._intervalFPS=30
        /** @type {(()=>void)[]} */
        this._onIntervalCallbacks=[]

        /** @type {Set<Element>} */
        this._generatedElements=new Set()

        /** @type {Map<Element,Element[]>} */
        this._ifParentChildrenList=new Map()

        if(options){
            if(options.intervalFPS){
                this._intervalFPS=options.intervalFPS
            }
        }

        const me=this
        setInterval(function(){
            me._onIntervalCallbacks.forEach((f)=>f())
        },1e3/this._intervalFPS)
    }
    /**
     * if obj is a proxy managing an object, return the original object
     * otherwise just return the object/argument
     * @template {object} T
     * @param {T|Proxy<T>} obj
     * @returns {T}
     */
    getUnmanaged(obj){
        if(this.managedProxies.has(obj)){
            return this.managedProxies.get(obj)
        }
        // @ts-ignore
        return obj
    }
    /**
     * 
     * @param {Element} element 
     * @returns {(()=>void)[]} - returns a function that can be called to remove the generated callbacks 
     */
    replaceMatches(element){
        const me=this
        let bindings_=Bindings.getForElement(element)

        if(!this.objTextNodes.has(element)){
            let textNodes=getTextNodes(element).map((node)=>{return {"node":node,"templateText":node.nodeValue}})
            textNodes=textNodes.filter((entry)=>{return entry.templateText!=null})
            /// @ts-ignore
            this.objTextNodes.set(element,textNodes)
        }
        const textNodes=this.objTextNodes.get(element)
        let remove_callbacks_from_textnodes=[]
        if(textNodes!=null && textNodes.length>0){
            for(let textNode of textNodes){
                const template=textNode.templateText

                const entries=getReplacements(template)
                if(entries.length==0)
                    continue;

                const entryValueCache=new Map()

                const bindings_str=bindings_.expand("bindings_")
                const entryFunctions=new Map()
                for(let entry of entries){
                    if(entryFunctions.has(entry)){continue;}
                    let entryfunc=new Function("bindings_",bindings_str+"; return "+entry)
                    entryFunctions.set(entry,entryfunc)
                }

                /**
                 * replace all matches to {{...}} with their evaluated values
                 * @param {boolean} init if true, registers callbacks to update the template text when a value changes
                 * @returns {(()=>void)[]}
                 */
                function replace(init=false){
                    /** save entries where the value has changed @type {Set<string>} */
                    let entryValueChanged=new Set()

                    let remove_callbacks=[]

                    let require_timedIntervalReplacement=false

                    for(let entry of entries){
                        if(init)
                            EvalStack.begin()

                        /** evaluate current value of the entry */

                        let newValue=undefined
                        try{
                            newValue=entryFunctions.get(entry)(bindings_)
                            /** if the value has changed, save new value and make note that the value for this entry has changed */
                            if(!(entryValueCache.has(entry) && entryValueCache.get(entry)===newValue)){
                                entryValueChanged.add(entry)
                                entryValueCache.set(entry,newValue)
                            }
                        }catch(e){
                            // if we fail to evaluate the current entry, just go on to the next one
                            continue;
                        }

                        if(init){
                            const stack=EvalStack.end()
                            const stack_bottom=(stack.length>0)?stack[stack.length-1]:null
                            // stack may be populated from partial expression
                            const stack_is_valid=stack.length>0 && newValue===stack_bottom[0][stack_bottom[1]]
                            if(!stack_is_valid){
                                require_timedIntervalReplacement=true
                            }else{
                                remove_callbacks.push(me.registerCallback(stack_bottom[0],(o,p,n)=>{
                                    replace(false)
                                },stack_bottom[1]))
                            }
                        }
                    }

                    if(init && require_timedIntervalReplacement){
                        const onIntervalCallback=()=>{
                            replace(false)
                        }
                        me._onIntervalCallbacks.push(onIntervalCallback)

                        remove_callbacks.push(function(){
                            let index=me._onIntervalCallbacks.indexOf(onIntervalCallback)
                            if(index<0){
                                return
                            }
                            me._onIntervalCallbacks.splice(index,1)
                        })
                    }
                    
                    if(entryValueChanged.size===0){
                        return remove_callbacks
                    }

                    let templateCopy=template+""
                    for(let entry of entries){
                        const newValue=entryValueCache.get(entry)
                        templateCopy=templateCopy.replace("{{"+entry+"}}",newValue)
                    }
                    textNode.node.nodeValue=templateCopy

                    return remove_callbacks
                }
                remove_callbacks_from_textnodes.push(replace(true))
            }
        }

        // iterate over all attributes and replace matches in their values
        const bindings_str=bindings_.expand("bindings_")
        for(let attributeIndex=0;attributeIndex<element.attributes.length;attributeIndex++){
            const attribute=element.attributes.item(attributeIndex)
            if(!attribute)continue;

            let remove_callbacks=[]
            const raw_value=attribute.value
            const entries=getReplacements(raw_value)

            /**
             * value cache to avoid redundant updates (which are costly on attributes)
             * @type{Map<string,any>}
             */
            const valuecache=new Map()

            const entryFunctions=new Map()
            for(let entry of entries){
                if(entryFunctions.has(entry)){continue;}
                let entryfunc=new Function("element","bindings_",bindings_str+"; return "+entry)
                entryFunctions.set(entry,entryfunc)
            }

            /** replace all templates in attribute value with values from cache */
            function replaceAll(){
                if(attribute==null)return;

                let new_value=raw_value
                for(let entry of entries){
                    new_value=new_value.replace("{{"+entry+"}}",valuecache.get(entry))
                }
                attribute.value=new_value
            }

            for(let entry of entries){
                EvalStack.begin()
                // run the function to populate the value stack
                const first_value=entryFunctions.get(entry)(element,bindings_)
                const stack=EvalStack.end()
                const stack_bottom=(stack.length>0)?stack[stack.length-1]:null
                // stack may be populated from partial expression
                const stack_is_valid=stack.length>0 && first_value===stack_bottom[0][stack_bottom[1]]

                valuecache.set(entry,first_value)

                /** @type{ProxySetterInterceptCallback} */
                const callbackOnValueChange=function(o,p,n){
                    if(attribute==null)return;

                    // refresh cached value
                    const freshvalue=entryFunctions.get(entry)(element,bindings_)
                    if(valuecache.has(entry) && valuecache.get(entry)===freshvalue){
                        return
                    }
                    valuecache.set(entry,freshvalue)
                    
                    replaceAll()
                }

                if(stack_is_valid){
                    remove_callbacks.push(
                        this.registerCallback(
                            stack_bottom[0],
                            callbackOnValueChange,
                            stack_bottom[1]
                        )
                    )
                }else{
                    // add callbackOnValueChange to timer callback on _p
                    function onIntervalCallback(){
                        // @ts-ignore
                        callbackOnValueChange(null,null,null)
                    }
                    this._onIntervalCallbacks.push(onIntervalCallback)

                    remove_callbacks.push(function(){
                        let index=me._onIntervalCallbacks.indexOf(onIntervalCallback)
                        if(index<0){
                            return
                        }
                        me._onIntervalCallbacks.splice(index,1)
                    })
                }
            }
            replaceAll()
   
            // TODO hacky solution to a common problem.. find a better way to handle this
            //
            // for tag=select elements, when the options are generated after the value has already been set,
            // the value is set to the value of the first element, regardless..
            // this callback below sets the value of the select element again, hopefully after all options have been generated
            if(attribute.name=="value" && element instanceof HTMLElement){
                this._onFirstDraw(element,()=>{
                    replaceAll()
                })
            }

            remove_callbacks_from_textnodes.push(remove_callbacks)
        }

        for(let child of element.children){
            Bindings.getForElement(child).inherit(bindings_)
            if(this._generatedElements.has(child)){
                continue;
            }
            remove_callbacks_from_textnodes.push(this.replaceMatches(child).flat(100))
        }

        return remove_callbacks_from_textnodes.flat(100)
    }
    /**
     * @brief register an object for managing, returns the wrapper (proxy) object
     * @template {object} T
     * @param {T|Proxy<T>} obj 
     * @param {ProxySetterInterceptCallback[]} inheritedCallbacks
     * @returns {T}
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
                me.objCallbacks.set(obj,inheritedCallbacks)
            }
            try{
                let _proxy=new Proxy(obj,{})
            }catch(e){
                console.error("failed to create proxy for object",obj)
                throw e
            }

            let new_proxy=new Proxy(obj,{
                get:(target,prop)=>{
                    if(!EvalStack.done){
                        /// @ts-ignore
                        EvalStack.stack.push([target,prop])
                    }
                    const ret=Reflect.get(target,prop)

                    // if prop is in this list of properties, return the value of the property immediately
                    if(typeof prop == "symbol" || typeof ret == "function" || ["valueOf","toString","length"].includes(prop)){
                        return ret
                    }

                    if(typeof ret=="object" && ret!=null){
                        /// @ts-ignore
                        return me.ensureManagedObject(ret,me.objCallbacks.get(obj))
                    }
                    EvalStack.done=true
                    return ret
                },
                set:(target,prop,value)=>{
                    Reflect.set(target,prop,value)
                    const namedObjectCallbacksForObj=me.namedObjCallbacks.get(obj)
                    if(namedObjectCallbacksForObj!=null){
                        const callbacks=namedObjectCallbacksForObj.get(prop)
                        if(callbacks!=null){
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
     * @returns {T}
     */
    manage(obj){
        return this.ensureManagedObject(obj)
    }
    /**
     * obj should be the regular (non-proxy) object
     * @param {object} obj 
     * @param {(o:object,property:PropertyKey,new_value:any)=>void} callback 
     * @param {PropertyKey?} key
     * @return {(()=>void)[]} - returns a function that can be called to remove the callback
     */
    registerCallback(obj,callback,key=null){
        let me=this
        if(key!=null){
            let this_obj_named_callbacks=this.namedObjCallbacks.get(obj)
            if(!this_obj_named_callbacks){
                this_obj_named_callbacks=new Map()
                this.namedObjCallbacks.set(obj,this_obj_named_callbacks)
            }

            let this_obj_callbacks_for_key=this_obj_named_callbacks.get(key)
            if(!this_obj_callbacks_for_key){
                this_obj_callbacks_for_key=[]
                this_obj_named_callbacks.set(key,this_obj_callbacks_for_key)
            }
            this_obj_callbacks_for_key.push(callback)

            return [function(){
                let i=this_obj_callbacks_for_key.indexOf(callback)
                if(i<0){return;}

                this_obj_callbacks_for_key.splice(i,1)
            }]
        }else{
            let obj_callbacks=this.objCallbacks.get(obj)
            if(!obj_callbacks){
                obj_callbacks=[]
                this.objCallbacks.set(obj,obj_callbacks)
            }
            obj_callbacks.push(callback)

            return [function(){
                let i=obj_callbacks.indexOf(callback)
                if(i<0){return;}
                obj_callbacks.splice(i,1)
            }]
        }
    }
    /**
     * 
     * @param {object} obj 
     * @param {PropertyKey} property 
     * @param {any} new_value 
     */
    triggerChange(obj,property,new_value){
        let callbacks=this.objCallbacks.get(obj)
        if(!callbacks){return;}

        // flatten to handle inherited callbacks
        for(let callback of callbacks.flat(100)){
            callback(obj,property,new_value)
        }
    }

    /**
     * 
     * @param {HTMLElement} element 
     * @param {()=>void} cb 
     */
    _onFirstDraw(element,cb){
        if(this._firstDrawCompleted.has(element)){
            cb()
            return
        }

        if(!this._firstDrawCallbacks.has(element)){
            this._firstDrawCallbacks.set(element,[])

            // on first draw, via intersectionobserver, call all callbacks
            const observer=new IntersectionObserver((entries,observer)=>{
                for(let entry of entries){
                    if(entry.isIntersecting){
                        this._firstDrawCompleted.add(element)

                        const callbacks=this._firstDrawCallbacks.get(element)
                        if(callbacks){
                            for(let cb of callbacks){
                                cb()
                            }

                            this._firstDrawCallbacks.delete(element)
                        }
                        observer.disconnect()
                    }
                }
            })
            observer.observe(element)
        }
        this._firstDrawCallbacks.get(element)?.push(cb)
    }
    /**
     * 
     * @param {object} obj 
     * @param {PropertyKey} property 
     * @param {ProxySetterInterceptCallback} callback 
     * @returns {(()=>void)[]} function to remove the callback
     */
    _onPropertyChange(obj,property,callback){
        const managed_obj=this.ensureManagedObject(obj)
        const unmanaged_obj=this.getUnmanaged(obj)

        EvalStack.begin()
        /**@ts-ignore */
        let currentValue=managed_obj[property]
        const stack=EvalStack.end()
        const stack_bottom=(stack.length>0)?stack[stack.length-1]:null
        // stack may be populated from partial expression
        const stack_is_valid=stack.length>0 && currentValue===stack_bottom[0][stack_bottom[1]]

        if(stack_is_valid){
            return this.registerCallback(unmanaged_obj,callback,property)
        }else{
            // add callbackOnValueChange to timer callback on _p
            function onIntervalCallback(){
                // @ts-ignore
                let new_value=managed_obj[property]

                const value_has_changed=new_value!==currentValue
                currentValue=new_value

                if(!value_has_changed){return;}

                // @ts-ignore
                callback(obj,property,new_value)
            }
            this._onIntervalCallbacks.push(onIntervalCallback)

            const me=this
            function remove(){
                let index=me._onIntervalCallbacks.indexOf(onIntervalCallback)
                if(index<0){
                    return
                }
                me._onIntervalCallbacks.splice(index,1)
            }

            return [remove]
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

            const element_parent=element.parentElement
            if(!element_parent){console.error(element,"has no parent");continue;}

            // if element is a template, remove it from the dom
            if(element.tagName.toLowerCase()=="template"){
                element.style.setProperty("display","none")
            }

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

            /** @type{(()=>void)[]} */
            let remove_callbacks=[]

            const p_if_attribute=element.getAttribute("p:if")
            if(p_if_attribute){
                // this is an unreactive property, so eval once -> if false, remove element, if true, continue processing other attributes etc.

                let stop_processing=false

                const bindings=new Bindings()
                bindings.inherit(bindings_in)
                // add local variable "element"
                bindings.add(new Binding("element",element))

                const show=eval(bindings.expand("bindings")+p_if_attribute)
                
                if(!show){
                    element_parent.removeChild(element)
                    stop_processing=true
                }

                if(stop_processing){
                    continue
                }
            }

            const p_for_attribute=element.getAttribute("p:for")
            if(p_for_attribute){
                let [item_name,container_name]=p_for_attribute.split(" of ")
                if(!item_name || !container_name){console.error("invalid p:for attribute",p_for_attribute);continue;}

                const _container_value=eval(bindings_in.expand("bindings_in")+container_name)
                if(_container_value==null)continue;
                /** @type{any} */
                let container=undefined
                try{
                    container=this.ensureManagedObject(_container_value)
                }catch(e){
                    throw e
                }

                // check if container is free-standing expression, e.g. "items", not a compound like "data.items" or "data(mydata).values[3]"
                let make_container_binding_for_element=false
                try{
                    eval("let "+container_name)
                    make_container_binding_for_element=true
                }catch(e){}
                
                const me=this

                // instantiate all of the items in this list for each item in the container
                /** @type {HTMLElement[]|HTMLCollection} */
                let element_templates=[]
                const elementTemplateDocumentFragment=templateElementContent(element)
                if(elementTemplateDocumentFragment){
                    element_templates=elementTemplateDocumentFragment.children
                }else{
                    element_templates=element.children
                }

                /** @type{ Map< number, object & { elements: Element[], delete: ()=>void } > } */
                let instances=new Map()

                /**
                 * 
                 * @param {any} item 
                 * @param {number} index 
                 */
                function instantiate(item,index){
                    // list of all elements instantiated from this one item
                    let newElements=[]

                    //
                    let old_instance_at_index=instances.get(index)
                    if(old_instance_at_index){
                        old_instance_at_index.delete()
                        instances.delete(index)
                    }

                    /** @type {object&{pos:InsertPosition,el:Element}} */
                    let reference_element={pos:"afterend",el:element}
                    const previous_element=instances.get(index-1)
                    if(previous_element && previous_element.elements[previous_element.elements.length-1].parentElement){
                        reference_element={pos:"afterend",el:previous_element.elements[previous_element.elements.length-1]}
                    }
                    const next_element=instances.get(index+1)
                    if(next_element && !previous_element && next_element.elements[0].parentElement){
                        reference_element={pos:"beforebegin",el:next_element.elements[0]}
                    }

                    for(let element_template of element_templates){
                        const clone=element_template.cloneNode(true)
                        if(!(clone instanceof Element)){console.error(clone,"not instanceof Element");throw new Error("clone not instanceof Element")}
                        clone.setAttribute("_pClonedFromTemplate","true") // identify clones in dom

                        newElements.push(clone)

                        const inheritedBindings=Bindings.getForElement(clone)
                        inheritedBindings.inherit(bindings_in)
                        inheritedBindings.add(new Binding(item_name,item))
                        
                        if(make_container_binding_for_element){
                            inheritedBindings.add(new Binding(container_name,container))
                        }

                        // insert clone into dom
                        reference_element.el.insertAdjacentElement(reference_element.pos,clone)

                        // insert additional clones after the previous one
                        reference_element={pos:"afterend",el:clone}

                        me._generatedElements.add(clone)
                    }

                    // init element and get cleanup callbacks
                    let remove_self_from_everything=me.init(newElements).remove

                    instances.set(index,{
                        elements:newElements,
                        delete:function(){
                            for(let el of newElements){
                                el.parentElement?.removeChild(el)
                                me._generatedElements.delete(el)
                            }
                            remove_self_from_everything.forEach(f=>f())
                        }
                    })
                }

                /** @ts-ignore - container is iterable */
                for(let [index,item] of container.entries()){
                    instantiate(item,index)
                }

                const regCBrm=this.registerCallback(this.managedProxies.get(container),(obj,property,newval)=>{
                    // if length is set, remove all instances that are out of bounds
                    // (ignore case where length is set to value larger than current size)
                    if(property=="length"){
                        for(let i=instances.size;i>newval && i>=0;i--){
                            // adjust by -1 because index is 0-based
                            instances.get(i-1)?.delete()
                        }
                        return
                    }

                    // check if property looks like an index
                    let index=null
                    try{
                        /// @ts-ignore
                        index=parseFloat(property)
                    }catch(e){
                        return;
                    }
                    // if property is not an index, ignore it (i.e. return)
                    if((index==null) || index<0)return;

                    instantiate(newval,index)
                })
                remove_callbacks=remove_callbacks.concat(regCBrm)
                remove_callbacks=remove_callbacks.concat(function(){
                    for(let instance of instances.values()){
                        instance.delete()
                    }
                })
            }

            // initialize all child elements
            remove_callbacks=remove_callbacks.concat(this.init(child_elements).remove)

            const p_init_attribute=element.getAttribute("p:init")
            if(p_init_attribute){
                let bindings=new Bindings()
                bindings.inherit(bindings_in)
                // add local variable "element"
                bindings.add(new Binding("element",element))
                const eval_str=bindings.expand("bindings")+p_init_attribute
                try{
                    eval(eval_str)
                }catch(e){
                    console.error("error evaling",eval_str)
                    throw e
                }
            }

            const p_init_vis_attribute=element.getAttribute("p:init-vis")
            if(p_init_vis_attribute){
                this._onFirstDraw(element,()=>{
                    let bindings=new Bindings()
                    bindings.inherit(bindings_in)
                    // add local variable "element"
                    bindings.add(new Binding("element",element))
                    eval(bindings.expand("bindings")+p_init_vis_attribute)
                })
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
                const stack=EvalStack.end()
                const stack_bottom=(stack.length>0)?stack[stack.length-1]:null
                // stack may be populated from partial expression
                const stack_is_valid=stack.length>0 && initial_value===stack_bottom[0][stack_bottom[1]]
                if(!stack_is_valid){
                    console.error("no eval stack. maybe object is not managed?",element,p_bind_attribute)
                    break
                }

                const bindings=Bindings.getForElement(element)
                const bindings_str=bindings.expand("bindings")

                let elementValuePropertyName=null
                if(elementIsCheckbox){
                    element.checked=initial_value
                    elementValuePropertyName="checked"
                }else{
                    element.value=initial_value
                    elementValuePropertyName="value"
                }

                // pre-compile functions to apply changes to the element's attribute
                const applyAttributeChangeFromJS2DOM=new Function("element","bindings",bindings_str+"element."+elementValuePropertyName+"="+p_bind_attribute)
                const applyAttributeChangeFromDOM2JS=new Function("element","bindings",bindings_str+p_bind_attribute+"=element."+elementValuePropertyName)

                /**
                 * block recursion, e.g.:
                 * 
                 * ... -> element value change -> js value changes -> element value changes -> ...
                 * */
                let writeInputValueBack=false

                // register callback to reflect js value changes in DOM
                this.registerCallback(stack_bottom[0],(o,p,n)=>{
                    if(writeInputValueBack){return;}

                    // set new value on input element
                    applyAttributeChangeFromJS2DOM(element,bindings)
                },stack_bottom[1])

                // register callback to reflect DOM value changes in js
                element.addEventListener("input",(event)=>{
                    writeInputValueBack=true

                    applyAttributeChangeFromDOM2JS(element,bindings)

                    writeInputValueBack=false
                })

                break
            }

            // handle p:tooltip attributes
            const p_tooltip_attribute=element.getAttribute("p:tooltip")
            if(p_tooltip_attribute){
                const tooltip_time_to_show_ms=350

                let tooltip_content=p_tooltip_attribute
                // do the replacement thing
                const entries=getReplacements(p_tooltip_attribute)
                for(let entry of entries){
                    let entryfunc=new Function("bindings_in",bindings_in.expand("bindings_in")+"; return "+entry)
                    tooltip_content=tooltip_content.replace("{{"+entry+"}}",entryfunc(bindings_in))
                }

                /** @type{HTMLElement?} */
                let tooltip_element=null
                function showTooltip(){
                    if(tooltip_element!=null){return}

                    // offset of element from top of viewport
                    let top=element.getBoundingClientRect().top
                    // center tooltip over element
                    let left=element.getBoundingClientRect().left+element.getBoundingClientRect().width/2

                    tooltip_element=document.createElement("div")
                    tooltip_element.classList.add("p-tooltip")
                    tooltip_element.textContent=tooltip_content

                    tooltip_element.style.setProperty("--top-offset",top+"px")
                    tooltip_element.style.setProperty("--left-offset",left+"px")

                    document.body.appendChild(tooltip_element)

                    // check if any edge of the tooltip is outside the viewport, shove it back in
                    const tooltip_rect=tooltip_element.getBoundingClientRect()
                    if(tooltip_rect.left<0){
                        tooltip_element.style.setProperty("--left-offset",left-tooltip_rect.left+"px")
                    }
                    if(tooltip_rect.right>window.innerWidth){
                        tooltip_element.style.setProperty("--left-offset",left-(tooltip_rect.right-window.innerWidth)+"px")
                    }
                    if(tooltip_rect.top<0){
                        tooltip_element.style.setProperty("--top-offset",top+tooltip_rect.height+"px")
                    }
                    if(tooltip_rect.bottom>window.innerHeight){
                        tooltip_element.style.setProperty("--top-offset",top-tooltip_rect.height+"px")
                    }
                }

                /** @type{number?} */
                let tooltip_time_to_show_timer=null
                element.addEventListener("mouseenter",()=>{
                    if(tooltip_time_to_show_timer!=null)return
                    tooltip_time_to_show_timer=setTimeout(()=>{tooltip_time_to_show_timer=null;showTooltip()},tooltip_time_to_show_ms)
                })
                element.addEventListener("mouseleave",()=>{
                    if(tooltip_time_to_show_timer!=null){
                        clearTimeout(tooltip_time_to_show_timer)
                        tooltip_time_to_show_timer=null
                        return
                    }

                    if(tooltip_element){
                        if(tooltip_element.parentElement){
                            tooltip_element.parentElement.removeChild(tooltip_element)
                        }
                        tooltip_element=null
                    }
                })
            }

            // handle p:on-* attributes, e.g. p:on-click="..."
            for(let attributeIndex=0;attributeIndex<element.attributes.length;attributeIndex++){
                let attribute=element.attributes.item(attributeIndex)
                if(!attribute)continue;

                const element_bindings=Bindings.getForElement(element)

                if(attribute.name.startsWith("p:on-")){
                    const eventnames=attribute.name.slice("p:on-".length)
                    const code=attribute.value
                    if(code){
                        const call_event_listener=new Function("event","element","element_bindings",element_bindings.expand("element_bindings")+" ; "+code)
                        for(let event_name of eventnames.split(",")){
                            event_name=event_name.trim()
                            if(event_name.length==0)continue;

                            element.addEventListener(event_name,(event)=>{
                                /** provide local variable 'event' for use in the eval statement */
                                try{
                                    call_event_listener(event,element,element_bindings)
                                }catch(e){
                                    console.error("error in event handler",code,"bindings:",element_bindings)
                                    throw e
                                }
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

/**
 * wraps an XMLHttpRequest object to provide a slightly more convenient interface
 */
class XHR{
    constructor(async=true){
        this.xhr=new XMLHttpRequest()
        this.async=async
        
        this.aborted=false
        /**
         * @type {((xhr:XMLHttpRequest)=>void)[]}
         */
        this.onload_funcs=[]
        /**
         * @type {(()=>void)[]}
         */
        this.onerror_funcs=[]

        this.returns=undefined

        this.xhr.onerror=()=>{
            if(this.aborted){
                return
            }
            this._onerror()
        }
        this.xhr.onload=()=>{
            if(this.aborted){
                return
            }

            if(this.xhr.status>=200 && this.xhr.status<300){
                this.returns=this._onsuccess()
            }else{
                this._onerror()
            }
        }
    }
    /**
     * @brief cancel this request
     */
    cancel(){
        this.aborted=true
        this.xhr.abort()
    }
    /**
     * @brief cancel this request (alias for this.cancel)
     */
    abort(){
        this.cancel()
    }
    /**
     * @brief internally used, execute all onerror callbacks
     */
    _onerror(){
        for(let cb of this.onerror_funcs){
            cb.bind(this.xhr)()
        }
    }
    /**
     * @brief internally used, execute all onsuccess callbacks
     * @returns {undefined|any|any[]}
     */
    _onsuccess(){
        /** @type{any[]} */
        let ret=[]
        for(let cb of this.onload_funcs){
            let res=cb(this.xhr)
            if(res!==undefined){
                ret.push(res)
            }
        }
        switch(ret.length){
            case 0:return;
            case 1:return ret[0];
            default:return ret
        }
    }
    /**
     * @brief add a callback to be executed on successful request
     * @param {(xhr:XMLHttpRequest)=>void} cb
     * @returns {this}
     */
    onload(cb){
        this.onload_funcs.push(cb)
        return this
    }
    /**
     * @brief add a callback to be executed on failed request
     * @param {()=>void} cb
     * @returns {this}
     */
    onerror(cb){
        this.onerror_funcs.push(cb)
        return this
    }
    /**
     * @brief send the request
     * @param {string} url 
     * @param {any|object|string|null} data
     * @param {"GET"|"POST"|"PUT"|"DELETE"|"HEAD"|"CONNECT"|"OPTIONS"|"TRACE"|"PATCH"} method
     * @param {undefined|string} content_type automatically inferred for some types of data, if not provided
     * @returns {undefined|any|any[]}
     */
    send(url,data=null,method="GET",content_type=undefined){
        if(this.aborted){
            console.error("post was called on an aborted request")
            return
        }

        this.xhr.open(method,url,this.async)

        let data_str=null
        if(data instanceof Object){
            if(content_type===undefined)
                content_type="application/json"

            data_str=JSON.stringify(data)
        }else if(data instanceof String || typeof data==="string"){
            if(content_type===undefined)
                content_type="text/plain"

            data_str=String(data)
        }else if(data!==null){
            console.error("data must be an object or string")
        }

        if(content_type)
            this.xhr.setRequestHeader("Content-Type", content_type)

        try{
            if(data===null){
                this.xhr.send()
            }else{
                this.xhr.send(data_str)
            }
        }catch(e){
            if(!this.aborted)
                this._onerror()
        }

        return this.returns
    }
}
