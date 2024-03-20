/// the central 'p' object is located here. It offers global functionality to the whole page to make it more reactive and interactive

/// new data can be introduced by just setting p.mynewdate=123
/// new functions can be introduced the same way, p.myfunc=function(){...}
/// to make data observable (more about this later), the new data needs either:
/// - if it is set outside of any interactive components:
/// - - needs to be an object with _observable:true, e.g. p.mynewdate={_observable:true, value:123}
/// - if it is set inside of an interactive component:
/// - - needs to be an wrapped manually with ObservableObject, e.g. p.mynewdate=new ObservableObject({value:123})

/// the p object is only accessible to an element if it has the class 'data', i.e. not to the whole subtree (!)
/// this allows the use of several shorthands and special functionality for the element:
/// - p:init='somefunc' -> calls p.somefunc(subtree_root_element) after the subtree is initialized
/// - p:init-vis='somefunc' -> calls p.somefunc(subtree_root_element) when the subtree is first drawn (e.g. when it becomes visible)
/// - p:on-eventname='somefunc' -> calls p.somefunc(event) when eventname is triggered on any element inside the subtree
/// - p:on-eventname='somefunc1,somefunc2' -> calls p.somefunc1(event) and p.somefunc2(event) when eventname is triggered on any element inside the subtree
/// - p:on-event1,event2='somefunc1,somefunc2' -> calls p.somefunc1(event) and p.somefunc2(event) when event1 or event2 is triggered on any element inside the subtree
/// - p:tooltip='some text' -> shows a tooltip with the given text when hovering over the element
/// - p:tooltip='#some_id' -> shows a tooltip with the innerHTML of the element with id 'some_id' when hovering over the element
/// - p:on-attrchange(src)='somefunc' -> calls p.somefunc(element) when the src attribute of the element changes
/// - p:on-attrchange(src,srcset)='somefunc' -> calls p.somefunc(element) when the src or srcset attribute of the element changes
/// - p:for='let i=0;i<5;i++' -> replaces the outerHTML of the element with copies of the innerHTML, where all {{whatever}} are replaced with the evaluated expression

/// - p:bind='p.mynewdate' -> binds the value of the input field to p.mynewdate (includes initialization, binds both ways, i.e. changes to p.mynewdate are reflected in the input field, and changes to the input field are reflected in p.mynewdate)

/// the one single exception (currently) to this rule are templates, which are lifted out of a subtree and saved in p.templates:
/// - <template name='some_template_name'>...</template> -> saves the template for later use
/// - the template is then accessible as p.templates.some_template_name as DocumentSnippet (only after the initialization of the subtree is complete, i.e. it is not immediately available in p:init, but e.g. in p:init-vis)

/**
 * checks if the argument is an object 
 * @param {any} obj 
 * @returns {boolean}
 */
function isObject(obj) {
    return obj === Object(obj)
}
/**
 * checks if the argument is iterable
 * @param {any} obj 
 * @returns {boolean}
 */
function isIterable(obj){
    return Symbol.iterator in Object(obj)
}
/**
 * returns the key of obj that has the value val, i.e. such that obj[key]===val
 * @param {object} obj 
 * @param {any} val 
 * @returns {null|Key}
 */
function keyOf(obj,val){
    for(let key in obj){
        if(obj[key]===val){
            return key
        }
    }
    return undefined
}

/**
 * returns a wrapper around an arbitrary value that makes it behave like an object
 * @param {any} value
 * @returns {object}
 */
function valueObject(value){
    return {
        _isValueObject:true,
        value: value,
        valueOf: function() {
            return this.value;
        },
    };
}

let observable_ret_container=true

/**
 * return a wrapper around an object that makes it observable
 * i.e. allows to register callbacks that are called when the object (or any subvalue) changes
 * @param {any} obj 
 * @param {null|object} parent 
 * @returns {Proxy}
 * 
 * @example
 * let c = { grid: { num_x: 2, num_y: 3 } };
 * 
 * c = make_observable(c)
 * c.onChange((prop, val, obj) => {
 *     console.log(`Property ${prop} changed to ${val}`);
 * })
 * 
 * c.grid={num_x:2,num_y:3} // Triggers the callback\
 * 
 * c.grid.onChange((prop, val, obj) => {
 *     console.log("grid changed!")
 * })
 * 
 * c.grid.num_x = 3; // Triggers the callback
 * c.grid.num_y = 4; // Triggers the callback
 * c.grid['num_z'] = 4; // Triggers the callback
 * 
 */
function make_observable(obj, parent=null) {
    if(!isObject(obj)){
        obj=valueObject(obj)
    }

    if(obj.__isObservable){
        return obj._proxy
    }

    obj._parent=parent
    obj.__isObservable = true
    obj._callbacks=[]
    obj._running=false

    /**
     * register cb to be called when the object changes
     * @param {CallableFunction} cb 
     * @returns {CallableFunction} function handle that removes the callback when called itself
     */
    obj.onChange = function(cb){
        obj._callbacks.push(cb)

        // return a function that removes the callback from the list
        return function(){
            obj._callbacks=obj._callbacks.filter(c=>c!==cb)
        }
    }
    function isPubliclyIterableSymbol(symbolname){
        if(symbolname.startsWith && symbolname.startsWith("_")){
            return false
        }

        // if the attribute is callable, skip
        if(typeof obj[symbolname] === 'function'){
            return false
        }

        return true
    }

    obj.copyRaw=function(){
        // this function strips the proxy from the object (and all its attributes, recursively) and returns the raw object

        if(obj._isValueObject===true){
            return obj.value
        }

        if(Array.isArray(obj)){
            let raw_arr=[]
            for(let element of obj){
                if(isObject(element)){
                    // if the element is observable, copy it recursively
                    if(!element.copyRaw){
                        // this creates element._proxy, if it does not exist yet!
                        element=make_observable(element,obj._proxy).copyRaw()
                    }else{
                        raw_arr.push(element.copyRaw())
                    }
                }else{
                    raw_arr.push(element)
                }
            }
            return raw_arr
        }

        let raw_obj={}
        for(let key in obj){
            if(!isPubliclyIterableSymbol(key)){
                continue
            }

            if(isObject(obj[key])){
                raw_obj[key]=obj._proxy[key].copyRaw()
            }else{
                raw_obj[key]=obj[key]
            }
        }

        return raw_obj
    }

    obj._trigger=function(property=undefined,value=undefined,target=undefined){
        obj._applyCallbacks(obj,property,value,target)
    }

    obj.withPaused=function(cb){
        obj._proxy._paused=true
        cb(obj._proxy)
        obj._proxy._paused=undefined
        if(obj._proxy._deferredChanges){
            obj._trigger(...obj._proxy._deferredChanges)
        }else{
            obj._trigger()
        }
        obj._proxy._deferredChanges=undefined
    }

    let handler = {
        /**
         * getter for the proxy object
         * called on target[property], with receiver being the proxy object
         * @param {object} target is obj
         * @param {any} property property name (can be any value, not just strings)
         * @param {ProxyHandler} receiver is obj._proxy
         * @returns 
         */
        get: (target, property, receiver) => {
            if(property.startsWith && property.startsWith("_")){
                return obj[property]
            }

            if(obj._isValueObject){
                return obj[property]
            }

            if(isPubliclyIterableSymbol(property)){
                let val=obj[property]
                if(isObject(val)) {
                    obj[property]=make_observable(val, obj._proxy)
                }else{
                    obj[property]=make_observable(valueObject(val), obj._proxy)
                    //window.alert("observable object contains non-observable object"+property+obj[property])
                }
            }

            let ret_val=obj[property]
            
            if((!observable_ret_container) && ret_val._isValueObject){
                return ret_val['value']
            }

            return ret_val
        },
        /**
         * getter for the proxy object
         * called on target[property]=value
         * 'this' is the proxy object (obj._proxy)
         * @param {object} target is obj
         * @param {any} property property name (can be any value, not just strings)
         * @param {any} value
         * @returns 
         */
        set: (target, property, value) => {
            // dont overwrite setter of private properties
            if(property.startsWith && property.startsWith("_")){
                return Reflect.set(target, property, value);
            }

            let old_value=obj._proxy[property]

            let current_target=obj

            if(!isObject(value)){
                value=valueObject(value)
            }
            
            value=make_observable(value, obj._proxy)
            current_target=value

            // if there was an object before, inherit its callbacks
            if (isObject(old_value) && old_value._callbacks) {
                for(let cb of old_value._callbacks){
                    value.onChange(cb)
                }
            }

            const result = Reflect.set(obj, property, value)

            if(obj._proxy._paused){
                obj._proxy._deferredChanges=[current_target,property,value,target]
                return result;
            }

            obj._applyCallbacks(current_target,property,value,target)

            return result;
        }
    };

    let proxy = new Proxy(obj, handler);

    obj._proxy=proxy

    /**
     * trigger callbacks of the object and all its parents
     * @param {*} current_target object that callbacks are triggered on
     * @param {any} property property that changed
     * @param {*} value new value
     * @param {*} target object that had its property value changed
     */
    obj._applyCallbacks=function(current_target,property,value,target){
        // if the value was changed, call all callbacks, then call all callbacks of the parent object, etc.
        // only propagate the change to parents until an object is hit that has already been changed (rather, that has started propagating changes itself)
        //
        // this is still not perfect because it doesn't handle the case where an object is changed twice in the same frame, but it's good enough for now
        // (the problem is that the value can be changed multiple times, but the callback is only run after the first change)
        let current_context_callbacks_registered=[]
        while(current_target){
            if(current_target._proxy==null || current_target._proxy._callbacks_ongoing){
                break
            }
            current_context_callbacks_registered.push(current_target)
            current_target._proxy._callbacks_ongoing=true
            current_target._callbacks.forEach(cb=>cb(property, value, target))
            current_target=current_target._parent
        }

        for(let unroll_target of current_context_callbacks_registered){
            unroll_target._proxy._callbacks_ongoing=false
        }
    }

    return proxy;
}

/**
 * return number of decimal digits of a number (digits after comma)
 * @param {Number} v 
 * @returns {Number}
 */
function getNumDecimalDigits(v){
    let [_,decimalDigits]=v.toString().split(".")
    if(!decimalDigits){
        return 0
    }

    return decimalDigits.length
}

/**
 * adjust number of decimals after number input value changed
 * (e.g. if the step value is 0.1, the input value should have 1 decimal digit)
 * @param {Event} event 
 */
function adjustNumDigitsAfterInput(event){
    let event_target=event.currentTarget || event.target

    let min_value=parseFloat(event_target.getAttribute("min"))
    let max_value=parseFloat(event_target.getAttribute("max"))
    let step_value=parseFloat(event_target.getAttribute("step"))

    let current_value=parseFloat(event_target.value)

    let value_was_changed=false
    if(current_value<min_value){
        current_value=min_value
        value_was_changed=true
    }else if(current_value>max_value){
        current_value=max_value
        value_was_changed=true
    }

    // only overwrite value if it was changed
    // (otherwise the cursor position would be reset to the end of the input field after every single character input in the field)
    if(value_was_changed){
        if(step_value){
            let num_decmial_digits=getNumDecimalDigits(step_value)
            current_value=current_value.toFixed(num_decmial_digits)
        }
        event_target.value=current_value
    }
}

/**
 * event to change the value of a numer input field on scroll.
 * triggers an onchange event on the input field as well
 * @param {WheelEvent} event 
 * @returns {void}
 */
function adjustInputNumberOnScroll(event){
    let event_target=event.currentTarget || event.target

    // mimic behaviour of disabled input fields
    let eventTarget_is_disabled=event_target.getAttribute("disabled")
    if(eventTarget_is_disabled != null){
        return
    }

    event.preventDefault()

    let min_value=parseFloat(event_target.getAttribute("min"))
    let max_value=parseFloat(event_target.getAttribute("max"))
    let step_value=parseFloat(event_target.getAttribute("step")) || 1

    let current_value=parseFloat(event_target.value)

    if(event.deltaY>0){
        current_value-=step_value
    }
    if(event.deltaY<0){
        current_value+=step_value
    }

    if(current_value<min_value){
        current_value=min_value
    }
    if(current_value>max_value){
        current_value=max_value
    }

    let num_decmial_digits=getNumDecimalDigits(step_value)
    event_target.value=current_value.toFixed(num_decmial_digits)

    // emit onchange event on same object
    let on_change_event=new Event("change",{
        bubbles:event.bubbles,
        cancelable:event.cancelable,
    })
    event_target.dispatchEvent(on_change_event)
}
/**
 * this function is used to decode html entities in strings
 * e.g. decodeHtml("&lt;") -> "<"
 * @param {string} html
 * @returns {string}
 */
function decodeHtml(html) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(html, 'text/html');
    return doc.documentElement.textContent;
}
/**
 * returns an expression tjat expands {{}} expressions using eval
 * e.g. eval("hi {{1+1}} there"+expand_expressions()) -> "hi 2 there"
 * @returns {string}
 */
function expand_expressions(){
    /// /{{(.*?)}}/g <- old
    /// /{{([\s\S]*?)}}/g <- new
    return `.replace(/{{([\\s\\S]*?)}}/g, (match, p1) => {
        p1=decodeHtml(p1)
        try{
            let __v=eval(p1);
            if(__v){
                return __v.valueOf();
            }
            return __v;
        }catch(e){
            console.warn("error expanding expression",p1,e)
            return match;
        }
    })`
}

/**
 * retrieve all text nodes from an element (includes any levels of nesting)
 * @param {HTMLElement} elem 
 * @returns {[TextNode]}
 */
function getAllTextNodes(elem) {
    var walker = document.createTreeWalker(elem, NodeFilter.SHOW_TEXT, null, false);
    var textNodes = [];
    var node;

    while(node = walker.nextNode()) {
        textNodes.push(node);
    }

    return textNodes;
}

/**
 * central object to manage p: bindings and other reactive functionality
 */
let p={
    templates:{},

    /** copy values from some tracked javascript object to the dom via element.value
     *  e.g. <input type="number" p:on-objchange(p.config.value)="value2value" value="1">
     * @param {object} info
     */
    value2value(info){
        if(info.value && typeof info.value=="object"){
            console.warn("value2value: value is an object, which is invalid",info.value)
            return
        }
        info.element.value=info.value
    },
    /**
     * copy values from some tracked javascript object to the dom via element.checked
     * e.g. <input type="number" p:on-objchange(p.config.value)="value2value" value="1">
     * @param {object} info
     */
    value2value_checkbox(info){
        if(info.value && typeof info.value=="object"){
            console.warn("value2value: value is an object, which is invalid",info.value)
            return
        }
        info.element.checked=info.value
    },
    /**
     * copy values from some tracked javascript object to the innerText of an element
     * @param {*} info 
     */
    value2innerText(info){
        info.element.innerText=info.value
    },

    /**
     * observer that triggers when an element is first drawn
     * (i.e., when it becomes visible)
     * @type {IntersectionObserver}
     */
    observer_first_draw:new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            // If the element is intersecting with the viewport (i.e., it's visible)
            if(entry.isIntersecting) {
                let element=entry.target

                for(let init_vis_func of element._p.init_vis_funcs){
                    init_vis_func(entry.target)
                }

                p.observer_first_draw.unobserve(element); // Stop observing this element
            }
        });
    }),
    /**
     * observer that triggers when an element is added to the dom
     * @type {MutationObserver}
     */
    observer_add_to_dom:new MutationObserver((mutations)=>{
        mutations.forEach((mutation)=>{
            if(mutation.type=="childList"){
                for(let node of mutation.addedNodes){
                    p.init(node,true)
                }
            }
        })
    }),
    observer_delta_vis:new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            let element=entry.target

            // false-y can be null or false
            let element_is_visible=element.getAttribute('_visible')=='true'

            let visibility_has_changed=false

            if(entry.isIntersecting){
                if(!element_is_visible){
                    visibility_has_changed=true
                    element.setAttribute('_visible',true)
                }
            }else{
                if(element_is_visible){
                    visibility_has_changed=true
                    element.setAttribute('_visible',false)
                }
            }

            if(visibility_has_changed){
                for(let vis_change_change of element._p.vis_change_funcs){
                    vis_change_change(entry)
                }
            }
        });
    }),
    /**
     * return the image data of an image element (as array of pixel values)
     * @param {ImageElement} img_element 
     * @param {boolean} also_return_canvas 
     * @returns {ImageData|[ImageData,HTMLCanvasElement,CanvasRenderingContext2D]}
     */
    get_img_data(img_element,also_return_canvas=false){
        const canvas = document.createElement('canvas');
        canvas.width=img_element.width
        canvas.height=img_element.height
    
        // Draw the image on canvas
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img_element, 0, 0);
    
        // Extract image data
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        if(also_return_canvas){
            return [imageData,canvas,ctx]
        }

        return imageData
    },

    save_config_on_ctrlcmd_s(event){
        /// event triggered by pressing ctrl/cmd+s (save current config as file)

        if ((event.ctrlKey || event.metaKey) && event.key === 's') {
            event.preventDefault()
            
            let config_data_to_download=p.config.copyRaw()

            let config_data_blob=new Blob([JSON.stringify(config_data_to_download)],{type:"application/json"})

            let config_data_url=URL.createObjectURL(config_data_blob)

            // Create an anchor element and set the URL as the Blob URL
            var a = document.createElement('a')
            a.href = config_data_url
            a.download = "config.json"

            // Append the anchor to the document and trigger the download
            document.body.appendChild(a)
            a.click()

            // Clean up by removing the element and revoking the Blob URL
            document.body.removeChild(a)
            URL.revokeObjectURL(a.href)
        }
    },

    /**
     * time between pointer entering p:tooltip element and the tooltip being displayed
     */
    tooltip_time_to_display_ms:500.0,
    /**
     * time after pointer leaves p:tooltip element before the tooltip is hidden
     */
    tooltip_time_to_hide_ms:300.0,
    /**
     * callback that is triggered upon pointer entering a p:tooltip element
     * @param {PointerEvent} event 
     * @param {boolean} skip_timeout 
     * @returns 
     */     
    tooltip_begin(event,skip_timeout=false){
        let event_target=event.currentTarget
        let tooltip_el=event_target.tooltip_element
        if(!tooltip_el){
            if(!this.templates.tooltip){
                console.error("global tooltip template not found")
                return
            }

            tooltip_el=this.templates.tooltip.cloneNode(true).children[0]

            let tooltip_text=event_target.getAttribute("p:tooltip")
            // if tooltip references a whole element, use its innerHTML as tooltip text, and remove that element from its parent
            if(tooltip_text.startsWith("#")){
                let tooltip_text_element=document.querySelector(tooltip_text)
                tooltip_el.innerHTML=tooltip_text_element.innerHTML

                tooltip_text_element.parentElement.removeChild(tooltip_text_element)
                tooltip_text_element.classList.add("processed")
            }else{
                tooltip_el.innerHTML=tooltip_text
            }

            tooltip_el.element_anker=event_target
            event_target.tooltip_element=tooltip_el
        }

        function clear_timers_to_visible(){
            if(this.tooltip_timer_to_visible){
                clearTimeout(this.tooltip_timer_to_visible)
                this.tooltip_timer_to_visible=null
            }

            if(tooltip_el.timer_to_visible){
                clearTimeout(tooltip_el.timer_to_visible)
                tooltip_el.timer_to_visible=null
            }
        }

        if(!skip_timeout){
            // if timer is already running, don't start another one
            if(tooltip_el.timer_to_visible && this.tooltip_timer_to_visible===tooltip_el.timer_to_visible){
                return
            }

            if(this.tooltip_timer_to_visible!==tooltip_el.timer_to_visible){
                clearTimeout(this.tooltip_timer_to_visible)
                this.tooltip_timer_to_visible=null
            }

            // event.currentTarget is null inside the timeout, so we need to save it here
            let escaping_event={currentTarget:event_target}

            // start timer where if the pointer is hovered over the element for this long, the tooltip is displayed
            tooltip_el.timer_to_visible=setTimeout(function(){
                p.tooltip_begin(escaping_event,true)
            },this.tooltip_time_to_display_ms)
            this.tooltip_timer_to_visible=tooltip_el.timer_to_visible

            // disable the timer if the pointer leaves the element
            // (and remove the event listener, so it doesn't get called multiple times)
            function onmouseleave(event){
                event_target.removeEventListener("mouseleave",onmouseleave)
                clear_timers_to_visible()
            }
            event_target.addEventListener("mouseleave",onmouseleave)

            return
        }

        clear_timers_to_visible()

        document.body.appendChild(tooltip_el)
        if(this.active_tooltip){
            this.tooltip_cancel(this.active_tooltip)
        }

        this.active_tooltip=tooltip_el
    },
    /**
     * this is called when the mouse leaves the element where the tooltip was triggered
     * @param {PointerEvent} event
     * @returns
     */
    tooltip_end(event){
        if(this.active_tooltip!==event.currentTarget.tooltip_element){
            return
        }

        let tooltip_el=event.currentTarget.tooltip_element
        tooltip_el.visibility_timer=setTimeout((() => {
            this.tooltip_cancel(tooltip_el)
        }).bind(this), this.tooltip_time_to_hide_ms);
    },
    /**
     * remove active tooltip from display
     * @param {HTMLElement} tooltip_el 
     */
    tooltip_cancel(tooltip_el){
        clearTimeout(tooltip_el.visibility_timer)
        tooltip_el.visibility_timer=null

        if(tooltip_el.parentElement){
            tooltip_el.parentElement.removeChild(tooltip_el)
        }

        if(this.active_tooltip===tooltip_el){
            this.active_tooltip=null
        }
    },

    /**
     * init p:bind functionality for an element
     * @param {HTMLElement} el 
     * @param {string} obj_bind 
     * @param {[{bindname:bindingValue}]} additional_bindings 
     * @returns 
     */
    apply_pbind(el,obj_bind=undefined,additional_bindings=[]){
        if(el._pbindApplied==true){
            console.log("p:bind already applied",el)
            return
        }

        if(el._bindings){
            additional_bindings=additional_bindings.concat(el._bindings)
        }

        for(let binding of additional_bindings){
            eval("var "+binding.bindname+"=binding.value")
        }

        el._pbindApplied=true
        if(obj_bind==undefined){
            obj_bind=el.getAttribute("p:bind")
        }
        if(!(obj_bind && obj_bind.length>0)){
            return
        }

        let obj=eval(obj_bind)
        if(!obj.__isObservable){
            window.alert("obj_bind not observable '"+obj_bind+"'")
            return
        }

        // if el is <input type="checkbox">, use .target.checked instead of .target.value, and value2value_checkbox instead of value2value

        let value_callback_func=null
        if(el.tagName=="INPUT" || el.tagName=="SELECT"){
            let key=keyOf(obj._parent,obj)

            if(el.getAttribute("type")=="checkbox"){
                el.addEventListener("change",function(ev){
                    obj._parent[key]=ev.target.checked
                })

                value_callback_func=p.value2value_checkbox
            }else{
                // 'input' is called on every keystroke, 'change' is called when the input field loses focus
                // input makes more sense for text input, change for everything else
                let event_type="change"
                if(el.getAttribute("type")=="text"){
                    event_type="input"
                }

                el.addEventListener(event_type,function(ev){
                    obj._parent[key]=ev.target.value
                })

                value_callback_func=p.value2value
            }
        }else{
            value_callback_func=p.value2innerText
        }
        
        this.register_objchange_callback(obj,value_callback_func,el,true)
    },
    /**
     * init p:for functionality for an element
     * @param {HTMLElement} el 
     * @param {string} for_clause 
     * @param {[{bindname:bindingValue}]} additional_bindings 
     * @returns 
     */
    apply_pfor(el,for_clause=undefined,additional_bindings=[]){
        if(for_clause==undefined){
            for_clause=el.getAttribute("p:for")
        }

        if(!(for_clause && for_clause.length>0)){
            return
        }

        if(el._bindings){
            additional_bindings=additional_bindings.concat(el._bindings)
        }

        for(let binding of additional_bindings){
            eval("var "+binding.bindname+"=binding.value")
        }

        // matches pattern <bindname> of <container expression>
        let [bindname,container_expression]=for_clause.split(" of ")
        if(bindname==undefined || container_expression==undefined){
            console.error("p:for : invalid 'for' clause (must be 'x of container') '",for_clause,"'")
            return
        }

        // minor optimization, the goal is not to make sure this is only called once (which it is not!)
        let container=undefined
        container=eval(container_expression)

        // initialize container exactly once
        if(!el._pForInitialized){
            el._pForInitialized=true

            // if the container is observable, register a callback to update the elements when the container changes
            if(container.__isObservable){
                let el_cb=this.register_objchange_callback(container,function(property,newval,obj){
                    // when the container changes, remove all previously created elements
                    if(el._pForInitialized===true){
                        for(let [old_child,_old_child_bindings] of el._pForElements){
                            if(old_child._destroy){
                                old_child._destroy()
                            }
                            old_child.parentElement.removeChild(old_child)
                        }
                        el._pForElements=[]
                    }

                    // then generated new elements
                    // TODO optimization possible: only generate the elements that are actually needed (re-use elements generated from preserved container entries)
                    p.apply_pfor(el,for_clause,additional_bindings)
                },el,false)

                // save the callback to be called when the element is destroyed
                // (removes the callback set above so that it is not called on an object removed from the dom)
                el._liveCallbacks=el._liveCallbacks || []
                el._liveCallbacks.push(el_cb)
            }
        }

        if(!isIterable(container)){
            return
        }

        let new_elements=[]

        for(let item of container){
            // eval clause allows <p p:for="item in container"> <input p:bind="item.value"></input> </p>
            eval("var "+bindname+"=item");

            let bindings=[
                {bindname:bindname,value:item}
            ].concat(additional_bindings)

            // instantiate each child of element container for each item in the container
            for(let child_element of el.content.children){
                let new_element=child_element.cloneNode(true);
                
                // eval attributes and innerhtml to allow for {{}} expressions without costly outerhtml changes
                for(let attribute of new_element.attributes){
                    attribute.value=eval('attribute.value'+expand_expressions());
                }
                new_element.innerHTML=eval('new_element.innerHTML'+expand_expressions());
                new_element._bindings=bindings

                new_elements.push([new_element,bindings])
            }
        }

        for(let [new_element,_] of new_elements){
            el.parentElement.insertBefore(new_element,el);
        }

        // trigger init functions for all new elements
        for(let [new_element,bindings] of new_elements){
            new_element._bindings=bindings
            // TODO this should not be required, but the init code is usually only applied to elements with the data class, which these might not have
            p.init(new_element,true,bindings)
        }

        el._pForElements=new_elements
        el._destroy=function(){
            for(let [old_child,_old_child_bindings] of el._pForElements){
                if(old_child._destroy){
                    old_child._destroy()
                }
                old_child.parentElement.removeChild(old_child)
            }
            // call all live callbacks
            // i.e. functions to unhook existing callbacks from the observable object
            if(el._liveCallbacks){
                for(let cb of el._liveCallbacks){
                    cb()
                }
            }
        }
    },

    /**
     * lift template elements out of the subtree and save them in p.templates
     * @param {HTMLElement} subtree_node 
     * @returns
     */
    liftTemplates(subtree_node){
        // save templates for later insertion
        for(let template of subtree_node.querySelectorAll("template")){
            let template_name=template.getAttribute("name")
            if(!template_name){
                continue
            }

            // remove template from DOM
            template.parentElement.removeChild(template)

            // save for later use
            this.templates[template_name]=template.content
        }
    },

    /**
     * perform initialization of a subtree
     * @param {Node} subtree 
     * @param {boolean} include_root 
     * @param {[{bindname:bindingValue}]} additional_bindings 
     * @returns 
     */
    init_node(subtree,include_root=false,additional_bindings=[]){
        if(!subtree.querySelectorAll){
            return
        }

        this.liftTemplates(subtree)

        additional_bindings=additional_bindings.concat(subtree._bindings || [])

        for(let binding of additional_bindings){
            eval("var "+binding.bindname+"=binding.value")
        }

        if(!(include_root && subtree.classList.contains("data"))){
            for(let element of subtree.querySelectorAll(".data")){
                // if a parent any number of levels up has the data class, do not initialize here (TODO this is not true)
                let closestDataParent=element.closest(".data")
                if(
                    // TODO make sure elements are initialized bottom-up, but p-for top-down
                    closestDataParent
                    && closestDataParent!=subtree
                    && closestDataParent!=element
                    && subtree.contains(closestDataParent)
                ){
                    console.log("skipping",subtree,element,closestDataParent)
                    continue
                }
                
                this.init_node(element,true,additional_bindings)
            }
            return
        }

        // process elements
        let element=subtree
        let el=element

        if(element._p && element._p.init_done===true){
            return
        }

        element._p={}

        let calls=[]

        let initExec=element.getAttribute("p:init")
        if(initExec){
            let init_func=function(){
                // may take 'element' as argument
                eval(initExec)
            }

            calls.push([init_func,[element]])
        }

        let tooltip_text=element.getAttribute("p:tooltip")
        if(tooltip_text){
            element.classList.add("has-tooltip")
            element.addEventListener("mouseenter",this.tooltip_begin)
            element.addEventListener("mouseleave",this.tooltip_end)
        }

        // call order:
        // 1) apply p:for
        // 2) apply p:init
        // 3) -- init children --
        // 4) apply p:bind
        // note: currently, no other function (other than of those 3 categories) is called immediately, \
        //   they register event listeners instead

        let for_clause=element.getAttribute("p:for")
        if(for_clause){
            calls.splice(0,0,[this.apply_pfor,[element,for_clause,additional_bindings]])
        }

        let initVisExec=element.getAttribute("p:init-vis")
        if(initVisExec){
            element._p.init_vis_funcs=[]

            element._p.init_vis_funcs.push(function(){
                // may take 'element' as argument
                eval(initVisExec)
            })

            p.observer_first_draw.observe(element);
        }

        // register all sorts of event callbacks
        for(let attribute of element.attributes){
            if(attribute.name.startsWith("p:on-")){
                let event_name_list=attribute.name.replace("p:on-","")
                
                if(attribute.value.length==0){
                    continue
                }

                let onEventExec="["+attribute.value+"]"
                
                let truncated_event_name_list=event_name_list.split("(")[0].split(",")
                for(let event_name of truncated_event_name_list){
                    /// this is a hack (really only should apply to p:on-[objchange|attrchange](...), in which case the event name list only has a single entry anyway )
                    let extended_event_name=(truncated_event_name_list.length!=1)?null:event_name_list

                    if(event_name=="resize"){
                        // resize observer doesnt work as expected (and is quite slow)
                        // and resize events are triggered when the element itself is being resized, not the parent
                        window.addEventListener("resize",function(event){
                            eval(onEventExec)
                        })
                    }else if(event_name.startsWith("vis-change")){
                        if(element._p.vis_change_funcs==null){
                            element._p.vis_change_funcs=[]
                        }
                        element._p.vis_change_funcs.push(function(){
                            eval(onEventExec)
                        })
                        p.observer_delta_vis.observe(element)
                    }else if(event_name.startsWith("objchange")){
                        let obj_list_string=extended_event_name.replace("objchange(","").replace(")","")
                        let obj_list=obj_list_string.split(",")

                        for(let obj_name of obj_list){
                            this.register_objchange_callback(eval(obj_name),function(info){
                                eval(onEventExec)
                            },element,true)
                        }
                    }else if(event_name.startsWith("attrchange")){
                        let attribute_list=extended_event_name.replace("attrchange(","").replace(")","").split(",")
                        let attribute_change_observer=new MutationObserver(function(mutationsList, observer){
                            mutationsList.forEach(mutation=>{
                                if(mutation.type==="attributes"){
                                    if(attribute_list.includes(mutation.attributeName)){
                                        console.error("not currently implemented")
                                        //p[event_func_name](mutation.target)
                                    }
                                }
                            })
                        })
                        attribute_change_observer.observe(element,{attributes:true})
                    }else{
                        element.addEventListener(event_name,function(event){
                            eval(onEventExec)
                        })
                    }
                }
            }
        }

        // apply all the calls
        for(let [func,args] of calls){
            func(...args)
        }

        // init all children
        this.init_node(element,false,additional_bindings)
        
        let obj_bind=element.getAttribute("p:bind")
        if(obj_bind){
            calls.push([this.apply_pbind,[element,obj_bind,additional_bindings]])
            let [func,args]=calls.pop()
            func(...args)
        }

        // for all text nodes that contain {{}} expressions, expand them
        for(let textNode of getAllTextNodes(element)){
            textNode.data=eval('textNode.data'+expand_expressions());
        }

        element._p.init_done=true

        //make all number input fields adhere to their min/max values during input and allow using scroll to adjust their values
        let subtree_with_input_tag=[]
        for(let element of subtree.querySelectorAll("input")){
            subtree_with_input_tag.push(element)
        }
        if(include_root && subtree.tagName=="INPUT"){
            subtree_with_input_tag.push(subtree)
        }
        for(let element of subtree_with_input_tag){
            let input_type=element.getAttribute("type")
            if(input_type=="number"){
                element.addEventListener("input",adjustNumDigitsAfterInput)

                let wheel_adjust=element.getAttribute("wheel-adjust")
                if(wheel_adjust==null || wheel_adjust==true){
                    element.addEventListener("wheel", adjustInputNumberOnScroll, {passive: false})
                }
            }
        }
    },

    /**
     * init p: functionality for a subtree
     * @param {Node} subtree 
     * @param {boolean} include_root 
     * @param {[{bindname:bindingValue}]} additional_bindings 
     */
    init(subtree=document,include_root=false,additional_bindings=[]){
        this.init_node(subtree,include_root,additional_bindings)

        this.observer_add_to_dom.observe(document.body,{attributes:false,childList:true,characterData:false,subtree:true})

        this.init_done=true
    },

    /**
     * register event_func to be called on element when obj changes
     * @param {Object} obj 
     * @param {CallableFunction} event_func 
     * @param {HTMLElement} element 
     * @param {boolean} initNowWithCurrentValue
     * @returns {null|CallableFunction} function that removes the callback from the list
     */
    register_objchange_callback(obj,event_func,element,initNowWithCurrentValue=false){
        // when obj changes, call event_func, referencing the element/domnode

        // if the root does not exist, error
        if(obj==undefined){
            console.error("objchange: object not found")
            window.alert("objchange: object not found")
            return
        }

        if(!obj.__isObservable){
            console.error("objchange: object not observable",obj)
            window.alert("objchange: object not observable")
            return
        }

        let cb_handle=(property, value, target) => {
            try{
                value=value.valueOf()
            }catch(e){}

            event_func({
                property:property,
                value:value,
                target:target,
                currentTarget:obj,
                element:element
            })
        }
        let cb_remove_func=obj.onChange(cb_handle);

        if(initNowWithCurrentValue===true){
            cb_handle(undefined,obj,obj)
        }

        return cb_remove_func
    },
}

// initialize p: functionality once the dom is loaded
document.addEventListener("DOMContentLoaded",function(){
    window.p=p
    for(let key in p){
        if(typeof p[key] === 'function'){
            p[key]=p[key].bind(p)
        }
        if(p[key]._observable){
            p[key]=make_observable(p[key])
        }
    }
    p.init()
})
